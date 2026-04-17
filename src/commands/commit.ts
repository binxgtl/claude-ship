import inquirer from "inquirer";
import fs from "fs";
import path from "path";
import { simpleGit } from "simple-git";
import { resolveDefaultProvider } from "../config.js";
import { generateText } from "../providers.js";
import { getStagedChangeContext } from "../git.js";
import { printBanner, printSuccess, printWarning, printInfo, spinner, c } from "../ui.js";
import { validateProvider, resolveProviderWithKey } from "../cli-helpers.js";

export interface CommitOptions {
  dir: string;
  provider?: string;
  apiKey?: string;
  all: boolean;
  push: boolean;
  yes: boolean;
}

const COMMIT_PROMPT = `You are a git commit message generator. Analyze the following git diff and staged file list, then write a single conventional commit message.

Rules:
- Use conventional commits format: type(scope): description
- Types: feat, fix, refactor, docs, style, test, chore, perf, ci, build
- Scope is optional - use it only when changes are clearly scoped to one area
- Description should be lowercase, imperative mood, no period at end
- Keep the first line under 72 characters
- If changes are substantial, add a blank line then a short body (2-3 bullet points max)
- Do NOT wrap the message in backticks or quotes
- Output ONLY the commit message, nothing else

Staged files:
{STAGED}

Diff:
{DIFF}`;

export async function runCommit(opts: CommitOptions) {
  await printBanner();
  const dir = fs.realpathSync(path.resolve(opts.dir));
  const git = simpleGit(dir);

  const isRepo = await git.checkIsRepo().catch(() => false);
  if (!isRepo) {
    throw new Error("Not a git repository. Run `git init` first.");
  }

  if (opts.all) {
    await git.add("-A");
  }

  const stagedContext = await getStagedChangeContext(dir);
  if (stagedContext.stagedFiles.length === 0) {
    if (stagedContext.unstagedCount > 0) {
      printWarning(`No staged changes. ${stagedContext.unstagedCount} unstaged file(s) found.`);
      printInfo("Use --all to stage everything, or stage manually with git add.");
    } else {
      printInfo("Nothing to commit - working tree clean.");
    }
    return;
  }

  printInfo(`${stagedContext.stagedFiles.length} staged file(s):`);
  for (const file of stagedContext.stagedFiles.slice(0, 15)) {
    console.log(`  ${c.dim(file)}`);
  }
  if (stagedContext.stagedFiles.length > 15) {
    console.log(c.dim(`  ... and ${stagedContext.stagedFiles.length - 15} more`));
  }
  console.log();

  const wasTruncated = stagedContext.diff.length > 8000;
  const truncatedDiff = wasTruncated
    ? stagedContext.diff.slice(0, 8000) + "\n... (truncated)"
    : stagedContext.diff;
  if (wasTruncated) {
    printWarning(`Diff is large (${(stagedContext.diff.length / 1024).toFixed(1)} KB) - truncated to 8 KB for AI context.`);
  }

  let provider = validateProvider(opts.provider ?? resolveDefaultProvider());
  const resolved = await resolveProviderWithKey(provider, opts.apiKey);
  if (!resolved) {
    throw new Error("API key required for commit message generation. Run `claude-ship config` to set one.");
  }
  provider = resolved.provider;
  const apiKey = resolved.apiKey;

  const prompt = COMMIT_PROMPT
    .replace("{STAGED}", stagedContext.stagedFiles.join("\n"))
    .replace("{DIFF}", truncatedDiff || "(no diff available)");

  const spinMsg = spinner("Generating commit message...");
  let message: string;
  try {
    message = await generateText({ provider, apiKey, prompt, maxTokens: 256 });
    message = message.trim().replace(/^```\n?/, "").replace(/\n?```$/, "").trim();
    spinMsg.succeed("Commit message generated");
  } catch (err) {
    spinMsg.fail("Failed to generate commit message");
    throw err;
  }

  console.log();
  console.log(c.bold("  Commit message:"));
  console.log();
  for (const line of message.split("\n")) {
    console.log(`  ${c.accent(line)}`);
  }
  console.log();

  if (!opts.yes) {
    const { action } = await inquirer.prompt<{ action: string }>([
      {
        type: "list",
        name: "action",
        message: "What would you like to do?",
        choices: [
          { name: "Commit with this message", value: "commit" },
          { name: "Edit message before committing", value: "edit" },
          { name: "Regenerate", value: "regenerate" },
          { name: "Cancel", value: "cancel" },
        ],
      },
    ]);

    if (action === "cancel") {
      printInfo("Cancelled.");
      return;
    }

    if (action === "edit") {
      const { edited } = await inquirer.prompt<{ edited: string }>([
        {
          type: "editor",
          name: "edited",
          message: "Edit commit message:",
          default: message,
        },
      ]);
      message = edited.trim();
      if (!message) {
        printWarning("Empty message - cancelled.");
        return;
      }
    }

    if (action === "regenerate") {
      const spinRetry = spinner("Regenerating...");
      try {
        message = await generateText({ provider, apiKey, prompt, maxTokens: 256 });
        message = message.trim().replace(/^```\n?/, "").replace(/\n?```$/, "").trim();
        spinRetry.succeed("New message generated");
      } catch (err) {
        spinRetry.fail("Failed");
        throw err;
      }
      console.log();
      for (const line of message.split("\n")) {
        console.log(`  ${c.accent(line)}`);
      }
      console.log();

      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
        { type: "confirm", name: "confirm", message: "Commit with this message?", default: true },
      ]);
      if (!confirm) {
        printInfo("Cancelled.");
        return;
      }
    }
  }

  const spinCommit = spinner("Committing...");
  await git.commit(message);
  spinCommit.succeed("Committed");

  if (opts.push) {
    const spinPush = spinner("Pushing...");
    try {
      await git.push();
      spinPush.succeed("Pushed to remote");
    } catch (err) {
      spinPush.warn("Push failed - you may need to push manually");
      printWarning(err instanceof Error ? err.message : String(err));
    }
  }

  printSuccess("Done!");
}

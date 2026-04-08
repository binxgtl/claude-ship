import { simpleGit } from "simple-git";
import fs from "fs";
import path from "path";
import { resolveDefaultProvider } from "../config.js";
import { generateText } from "../providers.js";
import { printBanner, printSuccess, printWarning, printInfo, spinner, c } from "../ui.js";
import { validateProvider, resolveProviderWithKey } from "../cli-helpers.js";
import inquirer from "inquirer";

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
- Scope is optional — use it only when changes are clearly scoped to one area
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

  const status = await git.status();
  const staged = [
    ...status.created.map((f) => `A  ${f}`),
    ...status.modified.filter((f) => status.staged.includes(f)).map((f) => `M  ${f}`),
    ...status.deleted.filter((f) => status.staged.includes(f)).map((f) => `D  ${f}`),
    ...status.renamed.map((r) => `R  ${r.from} → ${r.to}`),
  ];

  if (status.staged.length === 0 && staged.length === 0) {
    const unstaged = status.modified.length + status.not_added.length;
    if (unstaged > 0) {
      printWarning(`No staged changes. ${unstaged} unstaged file(s) found.`);
      printInfo("Use --all to stage everything, or stage manually with git add.");
    } else {
      printInfo("Nothing to commit — working tree clean.");
    }
    return;
  }

  const allStaged = status.staged.length > 0
    ? status.staged.map((f) => {
        if (status.created.includes(f)) return `A  ${f}`;
        if (status.deleted.includes(f)) return `D  ${f}`;
        return `M  ${f}`;
      })
    : staged;

  printInfo(`${allStaged.length} staged file(s):`);
  for (const f of allStaged.slice(0, 15)) {
    console.log(`  ${c.dim(f)}`);
  }
  if (allStaged.length > 15) {
    console.log(c.dim(`  ... and ${allStaged.length - 15} more`));
  }
  console.log();

  // Try remote diff first, fall back to local staged diff
  let diffContent = "";
  let diffSource = "staged";
  try {
    const branch = (await git.branch()).current;
    await git.fetch(["origin", branch]);
    diffContent = await git.diff([`origin/${branch}...HEAD`]);
    if (diffContent) diffSource = `origin/${branch}`;
  } catch { /* no remote or fetch failed */ }

  if (!diffContent) {
    diffContent = await git.diff(["--staged"]).catch(() => "");
  }

  const truncatedDiff = diffContent.length > 8000
    ? diffContent.slice(0, 8000) + "\n... (truncated)"
    : diffContent;

  if (diffSource !== "staged") {
    printInfo(`Comparing against ${c.bold(diffSource)}`);
  }

  let provider = validateProvider(opts.provider ?? resolveDefaultProvider());
  const resolved = await resolveProviderWithKey(provider, opts.apiKey);
  if (!resolved) {
    throw new Error("API key required for commit message generation. Run `claude-ship config` to set one.");
  }
  provider = resolved.provider;
  const apiKey = resolved.apiKey;

  const prompt = COMMIT_PROMPT
    .replace("{STAGED}", allStaged.join("\n"))
    .replace("{DIFF}", truncatedDiff || "(no diff available)");

  const spinMsg = spinner("Generating commit message…");
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
        printWarning("Empty message — cancelled.");
        return;
      }
    }

    if (action === "regenerate") {
      const spinRetry = spinner("Regenerating…");
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

  const spinCommit = spinner("Committing…");
  await git.commit(message);
  spinCommit.succeed("Committed");

  if (opts.push) {
    const spinPush = spinner("Pushing…");
    try {
      await git.push();
      spinPush.succeed("Pushed to remote");
    } catch (err) {
      spinPush.warn("Push failed — you may need to push manually");
      printWarning(err instanceof Error ? err.message : String(err));
    }
  }

  printSuccess(`Done!`);
}

import { Command } from "commander";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { printBanner, printError } from "./ui.js";
import { runConfigUI } from "./config-ui.js";
import { runInit } from "./init.js";
import { runShip } from "./commands/ship.js";
import { runReadme } from "./commands/readme-cmd.js";
import { runPush } from "./commands/push.js";
import { runChangelog } from "./commands/changelog-cmd.js";
import { runUpdate } from "./commands/update.js";
import { runBatch } from "./commands/batch.js";
import { runRelease } from "./commands/release.js";
import { runOpenAILogin } from "./openai-login.js";
import { runCommit } from "./commands/commit.js";
import { runDiff } from "./commands/diff.js";
import { runDoctor } from "./commands/doctor.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function action(fn: (...args: any[]) => Promise<void>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  };
}

export function createCLI(): Command {
  const program = new Command();

  const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  const pkgVersion: string = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;

  program
    .name("claude-ship")
    .description("Ship Claude-generated projects to GitHub in seconds")
    .version(pkgVersion);

  // ── ship (default) ─────────────────────────────────────────────────────────
  program
    .command("ship", { isDefault: true })
    .description("Parse a Claude response and ship it to a new GitHub repo")
    .option("--file <path>", "Path to a text file containing the Claude response")
    .option("--token <token>", "GitHub personal access token")
    .option("--name <name>", "Project / repository name")
    .option("--desc <description>", "Short project description")
    .option("--private", "Create a private GitHub repository", false)
    .option("--no-readme", "Skip AI README (use built-in template)")
    .option("--vi", "Generate README in Vietnamese (native developer style)", false)
    .option("--provider <name>", 'AI provider: "anthropic", "gemini", "openai", or "ollama"')
    .option("--api-key <key>", "API key for the selected provider")
    .option("--out <dir>", "Output directory (default: ./<project-name>)")
    .option("--no-push", "Scaffold files locally, skip GitHub push")
    .option("--org <org>", "GitHub organization to create the repo under")
    .option("--branch <name>", "Git branch name (default: main)")
    .option("--detail <level>", 'README detail: "short", "normal", "large", "carefully"')
    .option("--style <style>", 'README tone: "practical", "balanced", "marketing"')
    .option("--max-tokens <n>", "Max output tokens for README generation")
    .option("-d, --dry-run", "Preview what would be created — no writes, no API calls", false)
    .option("--ci", "Generate GitHub Actions CI workflow", false)
    .option("--docker", "Generate Dockerfile and docker-compose.yml", false)
    .option("--env-example", "Generate .env.example from detected env vars", false)
    .option("--hooks", "Generate pre-commit hooks (husky + lint-staged)", false)
    .action(action(runShip ));

  // ── readme ─────────────────────────────────────────────────────────────────
  program
    .command("readme")
    .description("Regenerate the README for an existing project")
    .option("--vi", "Generate in Vietnamese (native dev style)", false)
    .option("--dir <path>", "Project directory (default: cwd)", ".")
    .option("--provider <name>", 'AI provider', "anthropic")
    .option("--api-key <key>", "API key for the selected provider")
    .option("--detail <level>", 'README detail: "short", "normal", "large", "carefully"')
    .option("--style <style>", 'README tone: "practical", "balanced", "marketing"')
    .option("--max-tokens <n>", "Max output tokens for README generation")
    .option("--preview", "Preview generated README in terminal before writing", false)
    .action(action(runReadme ));

  // ── push ───────────────────────────────────────────────────────────────────
  program
    .command("push")
    .description("Push an existing local project to GitHub (creates repo if needed)")
    .option("--dir <path>", "Project directory (default: cwd)", ".")
    .option("--name <name>", "Repo name (default: from package.json or folder name)")
    .option("--desc <description>", "Repo description")
    .option("--private", "Create as private repo", false)
    .option("--token <token>", "GitHub personal access token")
    .option("--org <org>", "GitHub organization")
    .option("--branch <name>", "Branch name (default: main)")
    .option("--no-readme", "Skip README regeneration")
    .option("--vi", "Generate README in Vietnamese", false)
    .option("--provider <name>", 'AI provider')
    .option("--api-key <key>", "API key for the selected provider")
    .option("--detail <level>", 'README detail: "short", "normal", "large", "carefully"')
    .option("--style <style>", 'README tone: "practical", "balanced", "marketing"')
    .option("--max-tokens <n>", "Max output tokens for README generation")
    .option("--message <msg>", "Git commit message")
    .option("--diff", "Show changes summary and confirm before pushing", false)
    .option("--ci", "Generate GitHub Actions CI workflow", false)
    .option("--docker", "Generate Dockerfile and docker-compose.yml", false)
    .option("--env-example", "Generate .env.example from detected env vars", false)
    .option("--hooks", "Generate pre-commit hooks (husky + lint-staged)", false)
    .option("--ai-commit", "Generate commit message with AI instead of default", false)
    .action(action(runPush ));

  // ── config ─────────────────────────────────────────────────────────────────
  program
    .command("config")
    .description("Interactive config: manage API keys, GitHub token, and defaults")
    .action(action(runConfigUI ));

  // ── init ───────────────────────────────────────────────────────────────────
  program
    .command("init")
    .description("Scaffold a new project from a template (no Claude input needed)")
    .action(async () => {
      try {
        await printBanner();
        await runInit();
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ── changelog ──────────────────────────────────────────────────────────────
  program
    .command("changelog")
    .description("Generate CHANGELOG.md from git history using AI")
    .option("--dir <path>", "Project directory (default: cwd)", ".")
    .option("--provider <name>", 'AI provider')
    .option("--api-key <key>", "API key for the selected provider")
    .option("--count <n>", "Max commits to include (default: 100)")
    .action(action(runChangelog ));

  // ── update ─────────────────────────────────────────────────────────────────
  program
    .command("update")
    .description("Re-detect tech stack and update README badges, install instructions")
    .option("--dir <path>", "Project directory (default: cwd)", ".")
    .option("--provider <name>", 'AI provider')
    .option("--api-key <key>", "API key for the selected provider")
    .option("--vi", "Generate README in Vietnamese", false)
    .option("--detail <level>", 'README detail: "short", "normal", "large", "carefully"')
    .option("--style <style>", 'README tone: "practical", "balanced", "marketing"')
    .option("--max-tokens <n>", "Max output tokens for README generation")
    .action(action(runUpdate ));

  // ── batch ──────────────────────────────────────────────────────────────────
  program
    .command("batch")
    .description("Process multiple Claude response files into separate projects")
    .argument("<dir>", "Directory containing .txt or .md files with Claude responses")
    .option("--token <token>", "GitHub personal access token")
    .option("--private", "Create private repos", false)
    .option("--no-push", "Scaffold locally, skip GitHub push")
    .option("--provider <name>", 'AI provider for README generation')
    .option("--api-key <key>", "API key for the selected provider")
    .option("--out <dir>", "Parent output directory (default: cwd)")
    .option("--ci", "Generate GitHub Actions CI workflow", false)
    .option("--docker", "Generate Dockerfile and docker-compose.yml", false)
    .action(action(runBatch));

  // ── release ────────────────────────────────────────────────────────────────
  program
    .command("release")
    .description("Bump version, generate changelog, and create a GitHub Release")
    .option("--dir <path>", "Project directory (default: cwd)", ".")
    .option("--bump <type>", 'Version bump: "patch" (default), "minor", "major"', "patch")
    .option("--token <token>", "GitHub personal access token")
    .option("--provider <name>", 'AI provider for changelog')
    .option("--api-key <key>", "API key for the selected provider")
    .option("--draft", "Create as draft release", false)
    .action(action(runRelease ));

  // ── commit ─────────────────────────────────────────────────────────────────
  program
    .command("commit")
    .description("Generate a commit message with AI from staged changes")
    .option("--dir <path>", "Project directory (default: cwd)", ".")
    .option("--provider <name>", "AI provider")
    .option("--api-key <key>", "API key for the selected provider")
    .option("-a, --all", "Stage all changes before committing", false)
    .option("-p, --push", "Push to remote after committing", false)
    .option("-y, --yes", "Skip confirmation, commit immediately", false)
    .action(action(runCommit));

  // ── diff ───────────────────────────────────────────────────────────────────
  program
    .command("diff")
    .description("Compare a Claude response against an existing project and selectively apply changes")
    .option("--file <path>", "Path to a text file containing the Claude response")
    .option("--dir <path>", "Project directory to compare against (default: cwd)", ".")
    .option("-y, --yes", "Apply all changes without prompting", false)
    .action(action(runDiff));

  // ── doctor ─────────────────────────────────────────────────────────────────
  program
    .command("doctor")
    .description("Check prerequisites: runtime, API keys, GitHub auth")
    .action(action(runDoctor));

  // ── login ──────────────────────────────────────────────────────────────────
  program
    .command("login")
    .description("Authenticate with OpenAI via OAuth (use GPT models with your ChatGPT subscription)")
    .action(action(runOpenAILogin));

  return program;
}

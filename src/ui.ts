import chalk from "chalk";
import ora, { Ora } from "ora";

// ─── Color palette ────────────────────────────────────────────────────────────

export const c = {
  brand: chalk.hex("#7C3AED"),
  success: chalk.green,
  error: chalk.red,
  warn: chalk.yellow,
  info: chalk.cyan,
  dim: chalk.dim,
  bold: chalk.bold,
  path: chalk.hex("#38BDF8"),
  accent: chalk.hex("#F472B6"),
  muted: chalk.hex("#6B7280"),
};

// ─── Banner ───────────────────────────────────────────────────────────────────

export async function printBanner() {
  console.log();
  console.log(
    c.brand.bold(
      [
        "  ██████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗    ███████╗██╗  ██╗██╗██████╗ ",
        " ██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝    ██╔════╝██║  ██║██║██╔══██╗",
        " ██║     ██║     ███████║██║   ██║██║  ██║█████╗      ███████╗███████║██║██████╔╝",
        " ██║     ██║     ██╔══██║██║   ██║██║  ██║██╔══╝      ╚════██║██╔══██║██║██╔═══╝ ",
        " ╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗    ███████║██║  ██║██║██║     ",
        "  ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝    ╚══════╝╚═╝  ╚═╝╚═╝╚═╝     ",
      ].join("\n")
    )
  );
  console.log(
    c.dim("  Ship Claude-generated projects to GitHub in seconds") +
      "  " +
      c.accent("v" + (await getVersion()))
  );
  console.log();
}

async function getVersion(): Promise<string> {
  try {
    const { createRequire } = await import("module");
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as { version: string };
    return pkg.version;
  } catch {
    return "1.0.0";
  }
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

export function spinner(text: string): Ora {
  return ora({ text, color: "magenta", spinner: "dots" }).start();
}

// ─── Print helpers ────────────────────────────────────────────────────────────

export function printFileTree(tree: string) {
  console.log(c.dim(tree));
}

export function printSuccess(message: string) {
  console.log(c.success("✔ ") + message);
}

export function printError(message: string) {
  console.error(c.error("✖ ") + message);
}

export function printWarning(message: string) {
  console.warn(c.warn("⚠ ") + message);
}

export function printInfo(message: string) {
  console.log(c.info("ℹ ") + message);
}

export function printSeparator(char = "─", width = 60) {
  console.log(c.dim(char.repeat(width)));
}

// ─── Dry-run summary ──────────────────────────────────────────────────────────

export interface DryRunSummaryOpts {
  projectName: string;
  outputDir: string;
  fileCount: number;
  fileTree: string;
  stack: string;
  readmeSnippet: string;
  provider: string;
  vietnamese: boolean;
  wouldPush: boolean;
}

export function printDryRunSummary(opts: DryRunSummaryOpts) {
  console.log();
  printSeparator("─");
  console.log(c.brand.bold("  DRY RUN — nothing written to disk"));
  printSeparator("─");
  console.log();

  console.log(c.bold("  What would happen:"));
  console.log();

  // Output directory
  console.log(`  ${c.dim("Output dir:")}   ${c.path(opts.outputDir)}`);
  console.log(`  ${c.dim("Tech stack:")}   ${c.info(opts.stack)}`);
  console.log(`  ${c.dim("Files:")}        ${opts.fileCount} files + .gitignore + README.md`);
  console.log(
    `  ${c.dim("README:")}       ${opts.vietnamese ? "Vietnamese (--vi)" : "English"} via ${opts.provider}`
  );
  console.log(
    `  ${c.dim("GitHub:")}       ${opts.wouldPush ? "Create repo + push" : "Local only (--no-push)"}`
  );

  console.log();
  console.log(c.bold("  File tree:"));
  console.log(
    opts.fileTree
      .split("\n")
      .map((l) => "    " + c.dim(l))
      .join("\n")
  );

  if (opts.readmeSnippet) {
    console.log();
    console.log(c.bold("  README preview (first 12 lines):"));
    printSeparator("·", 60);
    const preview = opts.readmeSnippet
      .split("\n")
      .slice(0, 12)
      .map((l) => "  " + l)
      .join("\n");
    console.log(preview);
    printSeparator("·", 60);
  }

  console.log();
  console.log(
    c.dim("  Remove ") +
      c.accent("--dry-run") +
      c.dim(" to actually run this.")
  );
  console.log();
}

// ─── Post-ship summary ────────────────────────────────────────────────────────

export interface ShipSummaryOpts {
  projectName: string;
  filesCount: number;
  repoUrl: string;
  cloneUrl: string;
  stack: string;
  vietnamese: boolean;
}

export function printShipSummary(opts: ShipSummaryOpts) {
  console.log();
  printSeparator("═");
  console.log(c.bold.green("  🚀 Shipped successfully!"));
  printSeparator("═");
  console.log();
  console.log(`  ${c.dim("Project:")}  ${c.bold(opts.projectName)}`);
  console.log(`  ${c.dim("Stack:")}    ${c.info(opts.stack)}`);
  console.log(`  ${c.dim("Files:")}    ${opts.filesCount} files pushed`);
  console.log(`  ${c.dim("Repo:")}     ${hyperlink(opts.repoUrl, opts.repoUrl)}`);
  console.log();
  printSeparator("─");
  console.log(c.dim("  Clone it:"));
  console.log(`  ${c.accent("git clone " + opts.cloneUrl)}`);
  printSeparator("─");
  console.log();
  console.log(c.dim("  Next steps:"));
  console.log(`  ${c.muted("•")} Open:          ${hyperlink(opts.repoUrl, opts.repoUrl)}`);
  console.log(`  ${c.muted("•")} Add demo GIF:  edit README.md → Screenshot section`);
  if (!opts.vietnamese) {
    console.log(
      `  ${c.muted("•")} Vietnamese README: ${c.accent("claude-ship readme --vi")}`
    );
  }
  console.log(`  ${c.muted("•")} Share it on Viblo / AI Việt Nam 🇻🇳`);
  console.log();
}

/**
 * OSC 8 hyperlink — renders as a clickable link in terminals that support it
 * (iTerm2, Windows Terminal, VS Code terminal). Falls back to plain text.
 */
function hyperlink(label: string, url: string): string {
  // Only emit OSC 8 when we're in an interactive terminal
  if (process.stdout.isTTY) {
    return `\u001B]8;;${url}\u001B\\${c.path(label)}\u001B]8;;\u001B\\`;
  }
  return c.path(url);
}

// ─── Multiline stdin input ────────────────────────────────────────────────────

export async function readMultilineInput(prompt: string): Promise<string> {
  const { default: readline } = await import("readline");
  console.log(c.info(prompt));
  console.log(c.dim("  (Paste your content, then press Enter twice to finish)\n"));

  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    const lines: string[] = [];
    let emptyCount = 0;

    rl.on("line", (line) => {
      if (line === "") {
        emptyCount++;
        if (emptyCount >= 2) {
          rl.close();
          return;
        }
      } else {
        emptyCount = 0;
      }
      lines.push(line);
    });

    rl.on("close", () => resolve(lines.join("\n")));
  });
}

import { execSync } from "child_process";
import fs from "fs";
import { resolveApiKey, loadConfig, configFilePath } from "../config.js";
import { resolveGitHubToken, validateGitHubToken } from "../github.js";
import { findCodexAuthFile } from "../providers.js";
import { printBanner, c } from "../ui.js";

interface CheckResult {
  label: string;
  status: "pass" | "fail" | "warn";
  detail: string;
}

function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return "****" + key.slice(-4);
}

function runCommand(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

function checkNode(): CheckResult {
  const raw = runCommand("node --version");
  if (!raw) {
    return { label: "Node.js", status: "fail", detail: "not found" };
  }
  const match = raw.match(/v?(\d+)/);
  const major = match ? parseInt(match[1]!, 10) : 0;
  if (major < 18) {
    return { label: "Node.js", status: "fail", detail: `${raw} (>= 18 required)` };
  }
  return { label: "Node.js", status: "pass", detail: `${raw} (>= 18 required)` };
}

function checkGit(): CheckResult {
  const raw = runCommand("git --version");
  if (!raw) {
    return { label: "Git", status: "fail", detail: "not found" };
  }
  const ver = raw.replace("git version ", "").trim();
  return { label: "Git", status: "pass", detail: ver };
}

function checkGhCli(): CheckResult {
  const raw = runCommand("gh --version");
  if (!raw) {
    return { label: "GitHub CLI", status: "warn", detail: "not found (optional — install for easier auth)" };
  }
  const match = raw.match(/gh version ([\d.]+)/);
  const ver = match ? match[1]! : raw.split("\n")[0]!;
  return { label: "GitHub CLI", status: "pass", detail: ver };
}

function checkConfigFile(): CheckResult {
  const cfgPath = configFilePath();
  if (!fs.existsSync(cfgPath)) {
    return { label: "Config file", status: "warn", detail: `not found — run ${c.accent("claude-ship config")}` };
  }
  return { label: "Config file", status: "pass", detail: cfgPath };
}

function checkAnthropicKey(): CheckResult {
  const key = resolveApiKey("anthropic");
  if (!key) {
    return { label: "Anthropic key", status: "fail", detail: `not set — run ${c.accent("claude-ship config")} or set ANTHROPIC_API_KEY` };
  }
  return { label: "Anthropic key", status: "pass", detail: maskKey(key) };
}

function checkGeminiKey(): CheckResult {
  const key = resolveApiKey("gemini");
  if (!key) {
    return { label: "Gemini key", status: "fail", detail: `not set — run ${c.accent("claude-ship config")} or set GEMINI_API_KEY` };
  }
  return { label: "Gemini key", status: "pass", detail: maskKey(key) };
}

function checkOpenAI(): CheckResult {
  const key = resolveApiKey("openai");
  if (!key) {
    return { label: "OpenAI", status: "fail", detail: `not set — run ${c.accent("claude-ship login")} or set OPENAI_API_KEY` };
  }
  if (key === "codex-oauth") {
    const authFile = findCodexAuthFile();
    return { label: "OpenAI", status: "pass", detail: `Codex OAuth (${authFile ?? "tokens found"})` };
  }
  return { label: "OpenAI", status: "pass", detail: `API key ${maskKey(key)}` };
}

async function checkGitHubToken(): Promise<CheckResult> {
  try {
    const token = await resolveGitHubToken();
    try {
      const info = await validateGitHubToken(token);
      return { label: "GitHub token", status: "pass", detail: `@${info.username} (${info.scopes || "scopes unknown"})` };
    } catch {
      return { label: "GitHub token", status: "warn", detail: `token found but validation failed — may be expired` };
    }
  } catch {
    return { label: "GitHub token", status: "fail", detail: `not set — run ${c.accent("claude-ship config")} or ${c.accent("gh auth login")}` };
  }
}

function formatCheck(check: CheckResult, labelWidth: number): string {
  const icon = check.status === "pass"
    ? c.success("  ✔")
    : check.status === "warn"
      ? c.warn("  ⚠")
      : c.error("  ✖");
  const label = check.label.padEnd(labelWidth);

  const detail = check.status === "pass"
    ? c.dim(check.detail)
    : check.status === "warn"
      ? c.warn(check.detail)
      : c.error(check.detail);

  return `${icon} ${c.bold(label)} ${detail}`;
}

export async function runDoctor() {
  await printBanner();

  const checks: CheckResult[] = [];

  checks.push(checkNode());
  checks.push(checkGit());
  checks.push(checkGhCli());
  checks.push(checkConfigFile());
  checks.push(checkAnthropicKey());
  checks.push(checkGeminiKey());
  checks.push(checkOpenAI());
  checks.push(await checkGitHubToken());

  const labelWidth = Math.max(...checks.map((ch) => ch.label.length)) + 2;

  console.log();
  for (const check of checks) {
    console.log(formatCheck(check, labelWidth));
  }
  console.log();

  const passed = checks.filter((ch) => ch.status === "pass").length;
  const warned = checks.filter((ch) => ch.status === "warn").length;
  const failed = checks.filter((ch) => ch.status === "fail").length;
  const total = checks.length;

  const summary = `${passed}/${total} checks passed`;
  const extras: string[] = [];
  if (warned > 0) extras.push(`${warned} warning(s)`);
  if (failed > 0) extras.push(`${failed} failed`);

  const line = extras.length > 0
    ? `${summary}, ${extras.join(", ")}`
    : summary;

  if (failed > 0) {
    console.log(c.error(`  ${line}`));
  } else if (warned > 0) {
    console.log(c.warn(`  ${line}`));
  } else {
    console.log(c.success(`  ${line}`));
  }
  console.log();
}

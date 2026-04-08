import inquirer from "inquirer";
import { loadConfig, saveConfig, mergeConfig, clearConfigField, configFilePath } from "./config.js";
import { validateGitHubToken, listUserOrgs } from "./github.js";
import {
  requestDeviceCode,
  pollForToken,
} from "./github-oauth.js";
import { spinner, c, printSeparator } from "./ui.js";
import type { AppConfig, Provider, ReadmeDetail, LicenseType, ReadmeSections } from "./types.js";
import { licenseLabel } from "./readme.js";
import { findCodexAuthFile } from "./providers.js";
import { runOpenAILogin } from "./openai-login.js";

// ─── Screen helpers ───────────────────────────────────────────────────────────

function clearScreen() {
  // Works on both Windows Terminal and Unix
  process.stdout.write("\x1B[2J\x1B[H");
}

function maskKey(key: string, showChars = 4): string {
  if (key.length <= showChars) return "••••";
  return "••••••••••••" + key.slice(-showChars);
}

// ─── Tab types ────────────────────────────────────────────────────────────────

type Tab = "ai-keys" | "github" | "defaults" | "readme" | "files";

const TAB_LABELS: Record<Tab, string> = {
  "ai-keys": "AI Keys",
  github: "GitHub",
  defaults: "Defaults",
  readme: "README",
  files: "Files",
};

const TAB_ORDER: Tab[] = ["ai-keys", "github", "defaults", "readme", "files"];

// ─── Header & tab bar ─────────────────────────────────────────────────────────

function printHeader(activeTab: Tab) {
  const width = 62;
  const title = "  ⚙  claude-ship — Configuration";

  console.log();
  console.log(c.brand("  ╔" + "═".repeat(width) + "╗"));
  console.log(c.brand("  ║") + c.bold(title.padEnd(width)) + c.brand("║"));
  console.log(c.brand("  ╚" + "═".repeat(width) + "╝"));
  console.log();

  // Tab bar
  const tabs = TAB_ORDER.map((tab) => {
    const label = ` ${TAB_LABELS[tab]} `;
    return tab === activeTab
      ? c.brand.bold.inverse(label)
      : c.dim(label);
  }).join(c.dim("│"));

  console.log("  " + tabs);
  console.log(c.dim("  " + "─".repeat(width)));
  console.log();
}

// ─── Tab content renderers ────────────────────────────────────────────────────

function renderAiKeys(cfg: AppConfig): void {
  const anthropicStatus = cfg.anthropicApiKey
    ? c.success("● Saved    ") + c.dim(maskKey(cfg.anthropicApiKey))
    : c.dim("○ Not set");

  const geminiStatus = cfg.geminiApiKey
    ? c.success("● Saved    ") + c.dim(maskKey(cfg.geminiApiKey))
    : c.dim("○ Not set");

  const hasCodexOAuth = Boolean(findCodexAuthFile());
  const openaiKeyStatus = cfg.openaiApiKey
    ? c.success("● API Key  ") + c.dim(maskKey(cfg.openaiApiKey))
    : c.dim("○ No API key");
  const openaiOAuthStatus = hasCodexOAuth
    ? c.success("● OAuth    ") + c.dim("Codex tokens found")
    : c.dim("○ No OAuth tokens");

  console.log("  " + c.bold("Anthropic API Key") + c.dim("  (Claude Sonnet 4.6)"));
  console.log("  " + anthropicStatus);
  console.log();
  console.log("  " + c.bold("Gemini API Key") + c.dim("  (Gemini 3 Flash — free tier)"));
  console.log("  " + geminiStatus);
  console.log();
  console.log("  " + c.bold("OpenAI") + c.dim(`  (${cfg.openaiModel ?? "gpt-5.4"})`));
  console.log("  " + openaiKeyStatus);
  console.log("  " + openaiOAuthStatus);
  console.log();
  console.log(
    c.dim("  Keys are AES-256-GCM encrypted, bound to this machine.")
  );
  console.log(c.dim("  Stored at: " + configFilePath()));
  console.log();
}

function renderGitHub(cfg: AppConfig): void {
  if (cfg.githubToken) {
    const user = cfg.githubUsername ? `@${cfg.githubUsername}` : "unknown";
    const scopes = cfg.githubScopes ?? "unknown";
    console.log("  " + c.bold("GitHub Token") + "  " + c.success("● Connected"));
    console.log("  " + c.dim("Account: ") + c.info(user));
    console.log("  " + c.dim("Token:   ") + c.dim(maskKey(cfg.githubToken, 6)));
    console.log("  " + c.dim("Scopes:  ") + c.dim(scopes));
  } else {
    console.log("  " + c.bold("GitHub Token") + "  " + c.dim("○ Not connected"));
    console.log(c.dim("  Connect to enable auto-push without typing a token each time."));
  }
  console.log();
  console.log("  " + c.bold("Push Settings"));
  console.log("  " + c.dim("Org:    ") + (cfg.defaultOrg ? c.info(cfg.defaultOrg) : c.dim("personal account")));
  console.log("  " + c.dim("Branch: ") + c.info(cfg.defaultBranch ?? "main"));
  console.log("  " + c.dim("Remote: ") + c.info(cfg.useSshRemote ? "SSH (git@github.com:...)" : "HTTPS (https://github.com/...)"));
  console.log();
  console.log(c.dim("  Token fallback: --token flag → gh CLI → GITHUB_TOKEN env → saved here"));
  console.log();
}

const DETAIL_LABELS: Record<ReadmeDetail, string> = {
  short:     "Short      — tagline, 3–4 bullets, install only",
  normal:    "Normal     — standard README (default)",
  large:     "Large      — key files table, detailed usage, config section",
  carefully: "Carefully  — full architecture, every flag, troubleshooting",
};

function renderDefaults(cfg: AppConfig): void {
  const provider = cfg.defaultProvider ?? "anthropic";
  const detail = cfg.defaultReadmeDetail ?? "normal";

  console.log("  " + c.bold("Default AI Provider"));
  console.log("  " + c.info(provider === "anthropic" ? "● Anthropic (Claude Sonnet 4.6)" : "○ Anthropic") );
  console.log("  " + c.info(provider === "gemini"    ? "● Gemini (3 Flash — free)" : "○ Gemini") );
  console.log("  " + c.info(provider === "openai"    ? `● OpenAI (${cfg.openaiModel ?? "gpt-5.4"})` : "○ OpenAI") );
  console.log("  " + c.info(provider === "ollama"    ? "● Ollama (local)" : "○ Ollama") );
  console.log();
  console.log("  " + c.bold("Default Repository Visibility"));
  console.log("  " + (cfg.defaultPrivate ? c.warn("🔒 Private") : c.success("🌐 Public")));
  console.log();
  console.log("  " + c.bold("README Detail Level"));
  console.log("  " + c.info("● " + DETAIL_LABELS[detail]));
  console.log();
  console.log(c.dim("  These defaults apply when no flag is passed to ") + c.accent("claude-ship ship"));
  console.log();
}

const ALL_LICENSES: LicenseType[] = [
  "MIT", "Apache-2.0", "GPL-3.0", "AGPL-3.0",
  "BSD-2-Clause", "BSD-3-Clause", "ISC", "Unlicense", "proprietary",
];

const SECTION_LABELS: Record<keyof ReadmeSections, string> = {
  screenshot:   "📸 Screenshot",
  contributing: "🤝 Contributing / Đóng góp",
  license:      "📄 License",
  changelog:    "📝 Changelog",
  faq:          "❓ FAQ",
  starHistory:  "⭐ Star History chart",
};

function renderReadme(cfg: AppConfig): void {
  const sec = cfg.readmeSections ?? {};
  const on = (v?: boolean, def = true) => (v ?? def) ? c.success("● on") : c.dim("○ off");

  console.log("  " + c.bold("Language"));
  console.log("  " + c.info(cfg.defaultVi ? "● Vietnamese (--vi mặc định)" : "○ English (default)"));
  console.log();
  console.log("  " + c.bold("Detail level"));
  console.log("  " + c.info(DETAIL_LABELS[cfg.defaultReadmeDetail ?? "normal"]));
  console.log();
  console.log("  " + c.bold("License"));
  console.log("  " + c.info(licenseLabel(cfg.defaultLicense ?? "MIT")));
  console.log("  " + c.dim("Author: ") + c.info(cfg.projectAuthor ?? cfg.githubUsername ?? "(not set)"));
  console.log();
  console.log("  " + c.bold("Sections"));
  (Object.keys(SECTION_LABELS) as (keyof ReadmeSections)[]).forEach((k) => {
    const def = k === "screenshot" || k === "contributing" || k === "license";
    console.log("  " + on(sec[k], def) + "  " + SECTION_LABELS[k]);
  });
  console.log();
}

function readmeChoices(cfg: AppConfig): Choice[] {
  const sec = cfg.readmeSections ?? {};
  const sectionItems = (Object.keys(SECTION_LABELS) as (keyof ReadmeSections)[]).map((k) => {
    const def = k === "screenshot" || k === "contributing" || k === "license";
    const isOn = sec[k] ?? def;
    return { name: `${isOn ? "✓" : "✕"}  ${SECTION_LABELS[k]}`, value: `readme:toggle:${k}` };
  });
  return [
    { name: `⇄  Language: ${cfg.defaultVi ? "Vietnamese" : "English"} → switch`, value: "readme:toggle-vi" },
    { name: "✏  Detail level", value: "readme:detail" },
    sep("─── license"),
    { name: `✏  License: ${licenseLabel(cfg.defaultLicense ?? "MIT")}`, value: "readme:license" },
    { name: `✏  Author name: ${cfg.projectAuthor ?? cfg.githubUsername ?? "(not set)"}`, value: "readme:author" },
    sep("─── sections"),
    ...sectionItems,
    sep("─── navigate"),
    { name: "→  AI Keys tab", value: "__tab:ai-keys" },
    { name: "→  GitHub tab", value: "__tab:github" },
    { name: "→  Defaults tab", value: "__tab:defaults" },
    { name: "→  Files tab", value: "__tab:files" },
    sep(),
    { name: "✓  Done", value: "__exit__" },
  ];
}

const DEFAULT_AI_EXCLUDE = [".claude/**", "CLAUDE.md", ".env", ".env.*", "*.pem", "*.key"];
const DEFAULT_README_EXCLUDE = [".claude/**", "CLAUDE.md", "*.lock", ".env*"];

function renderPatternList(label: string, patterns: string[] | undefined, defaults: string[]): void {
  const active = patterns ?? defaults;
  const isDefault = patterns === undefined;
  console.log("  " + c.bold(label) + (isDefault ? c.dim("  (defaults)") : ""));
  if (active.length === 0) {
    console.log(c.dim("    (none — all files included)"));
  } else {
    active.forEach((p) => console.log(c.dim("    • ") + p));
  }
  console.log();
}

function renderFiles(cfg: AppConfig): void {
  renderPatternList("Git Include (only push matching)", cfg.gitIncludePatterns, []);
  renderPatternList("Git Exclude (never push)", cfg.gitExcludePatterns, []);
  renderPatternList("AI Exclude (never send to AI)", cfg.aiExcludePatterns, DEFAULT_AI_EXCLUDE);
  renderPatternList("README Exclude (omit from README)", cfg.readmeExcludePatterns, DEFAULT_README_EXCLUDE);
  console.log(c.dim("  Glob syntax: *.ts  src/**  .env*  !important"));
  console.log();
}

// ─── Action menus ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Choice = { name: string; value: string } | any;

function sep(label = ""): Choice {
  return new (inquirer as any).Separator(label ? c.dim(" " + label) : "");
}

function aiKeyChoices(cfg: AppConfig): Choice[] {
  return [
    { name: cfg.anthropicApiKey ? "✏  Edit Anthropic key" : "＋ Add Anthropic key", value: "edit:anthropic" },
    ...(cfg.anthropicApiKey ? [{ name: "✕  Clear Anthropic key", value: "clear:anthropic" }] : []),
    sep(),
    { name: cfg.geminiApiKey ? "✏  Edit Gemini key" : "＋ Add Gemini key", value: "edit:gemini" },
    ...(cfg.geminiApiKey ? [{ name: "✕  Clear Gemini key", value: "clear:gemini" }] : []),
    sep(),
    { name: "🌐 Login with OpenAI (OAuth via browser)", value: "openai:oauth-login" },
    { name: cfg.openaiApiKey ? "✏  Edit OpenAI API key (manual)" : "＋ Add OpenAI API key (manual)", value: "edit:openai" },
    ...(cfg.openaiApiKey ? [{ name: "✕  Clear OpenAI API key", value: "clear:openai" }] : []),
    { name: `✏  OpenAI model: ${cfg.openaiModel ?? "gpt-5.4"}`, value: "set:openai-model" },
    sep("─── navigate"),
    { name: "→  GitHub tab", value: "__tab:github" },
    { name: "→  Defaults tab", value: "__tab:defaults" },
    { name: "→  Files tab", value: "__tab:files" },
    sep(),
    { name: "✓  Done", value: "__exit__" },
  ];
}

function githubChoices(cfg: AppConfig): Choice[] {
  const hasToken = Boolean(cfg.githubToken);
  return [
    { name: "🔗 Connect via GitHub OAuth", value: "github:oauth" },
    { name: "🔑 Paste Personal Access Token", value: "github:pat" },
    ...(hasToken
      ? [
          { name: "✓  Validate current token", value: "github:validate" },
          { name: "✕  Disconnect", value: "github:clear" },
        ]
      : []),
    sep("─── push settings"),
    { name: cfg.defaultOrg ? `✏  Change org  (${cfg.defaultOrg})` : "＋ Set default org", value: "github:set-org" },
    ...(cfg.defaultOrg ? [{ name: "✕  Clear org (use personal account)", value: "github:clear-org" }] : []),
    { name: `✏  Branch: ${cfg.defaultBranch ?? "main"}`, value: "github:set-branch" },
    { name: `⇄  Remote: ${cfg.useSshRemote ? "SSH" : "HTTPS"} → switch to ${cfg.useSshRemote ? "HTTPS" : "SSH"}`, value: "github:toggle-ssh" },
    sep("─── navigate"),
    { name: "→  AI Keys tab", value: "__tab:ai-keys" },
    { name: "→  Defaults tab", value: "__tab:defaults" },
    { name: "→  Files tab", value: "__tab:files" },
    sep(),
    { name: "✓  Done", value: "__exit__" },
  ];
}

const PROVIDER_ORDER: Provider[] = ["anthropic", "gemini", "openai", "ollama"];

function defaultChoices(cfg: AppConfig): Choice[] {
  const provider = cfg.defaultProvider ?? "anthropic";
  const idx = PROVIDER_ORDER.indexOf(provider);
  const nextProvider = PROVIDER_ORDER[(idx + 1) % PROVIDER_ORDER.length]!;
  const detail = cfg.defaultReadmeDetail ?? "normal";
  return [
    {
      name: `Switch provider → ${nextProvider}`,
      value: `set:provider:${nextProvider}`,
    },
    {
      name: `Toggle visibility → ${cfg.defaultPrivate ? "public" : "private"}`,
      value: "toggle:private",
    },
    {
      name: `README detail: ${detail} → change`,
      value: "set:detail",
    },
    sep("─── navigate"),
    { name: "→  AI Keys tab", value: "__tab:ai-keys" },
    { name: "→  GitHub tab", value: "__tab:github" },
    { name: "→  README tab", value: "__tab:readme" },
    { name: "→  Files tab", value: "__tab:files" },
    sep(),
    { name: "✓  Done", value: "__exit__" },
  ];
}

type PatternField = "gitIncludePatterns" | "gitExcludePatterns" | "aiExcludePatterns" | "readmeExcludePatterns";

function filesChoices(cfg: AppConfig): Choice[] {
  const hasAny =
    cfg.gitIncludePatterns !== undefined ||
    cfg.gitExcludePatterns !== undefined ||
    cfg.aiExcludePatterns !== undefined ||
    cfg.readmeExcludePatterns !== undefined;

  return [
    { name: "✏  Edit Git Include patterns", value: "files:edit:gitIncludePatterns" },
    { name: "✏  Edit Git Exclude patterns", value: "files:edit:gitExcludePatterns" },
    { name: "✏  Edit AI Exclude patterns", value: "files:edit:aiExcludePatterns" },
    { name: "✏  Edit README Exclude patterns", value: "files:edit:readmeExcludePatterns" },
    ...(hasAny ? [{ name: "↺  Reset all to defaults", value: "files:reset" }] : []),
    sep("─── navigate"),
    { name: "→  AI Keys tab", value: "__tab:ai-keys" },
    { name: "→  GitHub tab", value: "__tab:github" },
    { name: "→  Defaults tab", value: "__tab:defaults" },
    sep(),
    { name: "✓  Done", value: "__exit__" },
  ];
}

// ─── Action handlers ──────────────────────────────────────────────────────────

const KEY_META: Record<string, { label: string; envVar: string; consoleUrl: string; configKey: keyof AppConfig }> = {
  anthropic: { label: "Anthropic", envVar: "ANTHROPIC_API_KEY", consoleUrl: "https://console.anthropic.com", configKey: "anthropicApiKey" },
  gemini: { label: "Gemini", envVar: "GEMINI_API_KEY", consoleUrl: "https://aistudio.google.com/app/apikey", configKey: "geminiApiKey" },
  openai: { label: "OpenAI", envVar: "OPENAI_API_KEY", consoleUrl: "https://platform.openai.com/api-keys", configKey: "openaiApiKey" },
};

async function handleEditKey(field: "anthropic" | "gemini" | "openai"): Promise<void> {
  const meta = KEY_META[field]!;

  console.log();
  console.log(c.dim(`  Get your key at: ${meta.consoleUrl}`));
  console.log(c.dim(`  Or set ${meta.envVar} env var to skip this.\n`));

  const { key } = await inquirer.prompt<{ key: string }>([
    {
      type: "password",
      name: "key",
      message: `${meta.label} API key:`,
      mask: "*",
    },
  ]);

  if (!key.trim()) {
    console.log(c.dim("  No key entered — unchanged."));
    return;
  }

  mergeConfig({ [meta.configKey]: key.trim() } as Partial<AppConfig>);
  console.log(c.success(`\n  ✔ ${meta.label} key saved.`));
  await pause();
}

async function handleClearKey(field: "anthropic" | "gemini" | "openai"): Promise<void> {
  const meta = KEY_META[field]!;
  const label = meta.label;
  const configKey = meta.configKey;

  const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
    {
      type: "confirm",
      name: "confirm",
      message: `Clear ${label} API key?`,
      default: false,
    },
  ]);

  if (confirm) {
    clearConfigField(configKey as keyof AppConfig);
    console.log(c.success(`\n  ✔ ${label} key cleared.`));
    await pause();
  }
}

const OPENAI_MODELS = [
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
];

async function handleSetOpenAIModel(): Promise<void> {
  const cfg = loadConfig();
  const current = cfg.openaiModel ?? "gpt-5.4";
  const choices = [
    ...OPENAI_MODELS.map((m) => ({ name: m === current ? `${m} (current)` : m, value: m })),
    { name: "Custom…", value: "__custom__" },
  ];
  const { model } = await inquirer.prompt<{ model: string }>([
    { type: "list", name: "model", message: "Select OpenAI model:", choices },
  ]);
  let final = model;
  if (model === "__custom__") {
    const { custom } = await inquirer.prompt<{ custom: string }>([
      { type: "input", name: "custom", message: "Enter model name:", default: current },
    ]);
    final = custom.trim();
  }
  if (final) {
    mergeConfig({ openaiModel: final });
    console.log(c.success(`\n  ✔ OpenAI model set to ${final}`));
  }
  await pause();
}

async function handleGitHubPat(): Promise<void> {
  console.log();
  console.log(c.dim("  Create a token at: https://github.com/settings/tokens"));
  console.log(c.dim("  Required scopes: repo, read:user\n"));

  const { token } = await inquirer.prompt<{ token: string }>([
    {
      type: "password",
      name: "token",
      message: "Personal Access Token:",
      mask: "*",
    },
  ]);

  if (!token.trim()) {
    console.log(c.dim("\n  No token entered — unchanged."));
    await pause();
    return;
  }

  const spin = spinner("Validating token…");
  try {
    const info = await validateGitHubToken(token.trim());
    spin.succeed(`Validated — connected as ${c.info("@" + info.username)}`);
    mergeConfig({
      githubToken: token.trim(),
      githubUsername: info.username,
      githubScopes: info.scopes,
    });
    console.log(c.success("  ✔ GitHub token saved."));
  } catch (err) {
    spin.fail("Token validation failed");
    console.log(c.error("  " + (err instanceof Error ? err.message : String(err))));
  }

  await pause();
}

async function resolveOAuthClientId(): Promise<string | undefined> {
  // Priority: env var → saved config → prompt user
  const fromEnv = process.env["CLAUDE_SHIP_CLIENT_ID"];
  if (fromEnv) return fromEnv;

  const saved = loadConfig().oauthClientId;
  if (saved) return saved;

  console.log();
  console.log(c.bold("  GitHub OAuth App required\n"));
  console.log(c.dim("  OAuth uses the GitHub Device Flow — you need a free OAuth App client_id."));
  console.log(c.dim("  Steps:"));
  console.log(c.dim("    1. Go to: https://github.com/settings/developers"));
  console.log(c.dim("    2. New OAuth App → enable Device Flow → any Homepage URL"));
  console.log(c.dim("    3. Copy the Client ID (public, not a secret)\n"));

  const { clientId } = await inquirer.prompt<{ clientId: string }>([
    {
      type: "input",
      name: "clientId",
      message: "GitHub OAuth App Client ID (blank = cancel):",
    },
  ]);

  if (!clientId.trim()) return undefined;

  mergeConfig({ oauthClientId: clientId.trim() });
  console.log(c.success("  ✔ Client ID saved.\n"));
  return clientId.trim();
}

async function handleGitHubOAuth(): Promise<void> {
  console.log();
  try {
    const clientId = await resolveOAuthClientId();
    if (!clientId) {
      console.log(c.dim("  Cancelled."));
      await pause();
      return;
    }

    const spin = spinner("Requesting device code from GitHub…");
    const state = await requestDeviceCode(clientId);
    spin.stop();

    console.log();
    printSeparator();
    console.log(c.bold("  Authorise claude-ship in your browser:\n"));
    console.log(`  ${c.dim("1.")} Open: ${c.path(state.verificationUri)}`);
    console.log(`  ${c.dim("2.")} Enter code: ${c.brand.bold(state.userCode)}`);
    printSeparator();
    console.log();

    // Try to open browser automatically (best-effort — not a required dep)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const openModule = await import("open" as any);
      const openFn = openModule.default ?? openModule;
      await openFn(state.verificationUri);
      console.log(c.dim("  (Browser opened automatically)\n"));
    } catch {
      // 'open' not installed — user opens manually
    }

    const pollSpin = spinner("Waiting for authorisation…");
    let dots = 0;
    const token = await pollForToken(
      state.deviceCode,
      state.interval,
      state.expiresIn,
      clientId,
      () => {
        dots++;
        pollSpin.text = "Waiting for authorisation" + ".".repeat((dots % 3) + 1);
      }
    );
    pollSpin.succeed("Authorised!");

    const valSpin = spinner("Fetching account info…");
    const info = await validateGitHubToken(token);
    valSpin.succeed(`Connected as ${c.info("@" + info.username)}`);

    mergeConfig({
      githubToken: token,
      githubUsername: info.username,
      githubScopes: info.scopes,
    });
    console.log(c.success("\n  ✔ GitHub token saved."));
  } catch (err) {
    console.log(c.error("\n  ✖ " + (err instanceof Error ? err.message : String(err))));
  }

  await pause();
}

async function handleValidateGitHubToken(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.githubToken) {
    console.log(c.warn("\n  No token saved."));
    await pause();
    return;
  }

  const spin = spinner("Validating…");
  try {
    const info = await validateGitHubToken(cfg.githubToken);
    spin.succeed(`Valid — @${info.username}  scopes: ${info.scopes}`);
    mergeConfig({ githubUsername: info.username, githubScopes: info.scopes });
  } catch {
    spin.fail("Token is invalid or expired — consider reconnecting.");
  }

  await pause();
}

async function handleClearGitHubToken(): Promise<void> {
  const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
    { type: "confirm", name: "confirm", message: "Disconnect GitHub token?", default: false },
  ]);

  if (confirm) {
    const cfg = loadConfig();
    delete cfg.githubToken;
    delete cfg.githubUsername;
    delete cfg.githubScopes;
    saveConfig(cfg);
    console.log(c.success("\n  ✔ GitHub token cleared."));
    await pause();
  }
}

async function handleSetProvider(provider: Provider): Promise<void> {
  mergeConfig({ defaultProvider: provider });
  console.log(c.success(`\n  ✔ Default provider set to ${c.bold(provider)}.`));
  await pause();
}

async function handleSetReadmeDetail(): Promise<void> {
  const { detail } = await inquirer.prompt<{ detail: ReadmeDetail }>([{
    type: "list",
    name: "detail",
    message: "Default README detail level:",
    choices: (["short", "normal", "large", "carefully"] as ReadmeDetail[]).map((d) => ({
      name: DETAIL_LABELS[d],
      value: d,
    })),
    default: loadConfig().defaultReadmeDetail ?? "normal",
  }]);
  mergeConfig({ defaultReadmeDetail: detail });
  console.log(c.success(`\n  ✔ README detail set to ${c.bold(detail)}.`));
  await pause();
}

async function handleTogglePrivate(): Promise<void> {
  const cfg = loadConfig();
  const next = !cfg.defaultPrivate;
  mergeConfig({ defaultPrivate: next });
  console.log(c.success(`\n  ✔ Default visibility set to ${c.bold(next ? "private" : "public")}.`));
  await pause();
}

async function handleEditPatterns(field: PatternField): Promise<void> {
  const FIELD_LABELS: Record<PatternField, { title: string; hint: string; defaults: string[] }> = {
    gitIncludePatterns: { title: "Git Include (only push matching files)", hint: "Empty = push all files", defaults: [] },
    gitExcludePatterns: { title: "Git Exclude (never push)", hint: "e.g. secrets, large binaries", defaults: [] },
    aiExcludePatterns: { title: "AI Exclude (never send to AI)", hint: "e.g. .env, private keys", defaults: DEFAULT_AI_EXCLUDE },
    readmeExcludePatterns: { title: "README Exclude (omit from README context)", hint: "e.g. lockfiles", defaults: DEFAULT_README_EXCLUDE },
  };

  const meta = FIELD_LABELS[field];
  const cfg = loadConfig();
  const current: string[] = cfg[field] ?? meta.defaults;

  while (true) {
    clearScreen();
    console.log();
    console.log("  " + c.bold(meta.title));
    console.log("  " + c.dim(meta.hint));
    console.log();

    if (current.length === 0) {
      console.log(c.dim("  (no patterns — " + (field === "gitIncludePatterns" ? "all files included" : "nothing excluded") + ")"));
    } else {
      current.forEach((p, i) => console.log(`  ${c.dim(String(i + 1) + ".")} ${p}`));
    }
    console.log();

    const subChoices: Choice[] = [
      { name: "＋ Add pattern", value: "add" },
      ...(current.length > 0 ? [{ name: "✕  Remove a pattern", value: "remove" }] : []),
      ...(JSON.stringify(current) !== JSON.stringify(meta.defaults) && meta.defaults.length > 0
        ? [{ name: "↺  Reset to defaults", value: "reset" }]
        : []),
      { name: "✓  Done", value: "done" },
    ];

    const { sub } = await inquirer.prompt<{ sub: string }>([{
      type: "list",
      name: "sub",
      message: "Action:",
      choices: subChoices,
    }]);

    if (sub === "done") break;

    if (sub === "add") {
      const { pattern } = await inquirer.prompt<{ pattern: string }>([{
        type: "input",
        name: "pattern",
        message: "Glob pattern (e.g. .env*, *.key, src/**/*.ts):",
        validate: (v: string) => v.trim().length > 0 || "Pattern cannot be empty",
      }]);
      const trimmed = pattern.trim();
      if (!current.includes(trimmed)) current.push(trimmed);
      mergeConfig({ [field]: [...current] } as Partial<AppConfig>);
      console.log(c.success(`\n  ✔ Added: ${trimmed}`));
      await pause(600);
    } else if (sub === "remove") {
      const removeChoices = current.map((p) => ({ name: p, value: p }));
      const { toRemove } = await inquirer.prompt<{ toRemove: string }>([{
        type: "list",
        name: "toRemove",
        message: "Remove which pattern?",
        choices: removeChoices,
        pageSize: Math.min(removeChoices.length, Math.max(10, (process.stdout.rows ?? 24) - 6)),
      }]);
      const idx = current.indexOf(toRemove);
      if (idx !== -1) current.splice(idx, 1);
      mergeConfig({ [field]: [...current] } as Partial<AppConfig>);
      console.log(c.success(`\n  ✔ Removed: ${toRemove}`));
      await pause(600);
    } else if (sub === "reset") {
      current.length = 0;
      meta.defaults.forEach((p) => current.push(p));
      mergeConfig({ [field]: [...current] } as Partial<AppConfig>);
      console.log(c.success("\n  ✔ Reset to defaults."));
      await pause(600);
    }
  }
}

async function handleToggleVi(): Promise<void> {
  const cfg = loadConfig();
  const next = !cfg.defaultVi;
  mergeConfig({ defaultVi: next });
  console.log(c.success(`\n  ✔ Default language set to ${c.bold(next ? "Vietnamese" : "English")}.`));
  await pause();
}

async function handleSetLicense(): Promise<void> {
  const { license } = await inquirer.prompt<{ license: LicenseType }>([{
    type: "list",
    name: "license",
    message: "Default license:",
    choices: ALL_LICENSES.map((l) => ({ name: licenseLabel(l), value: l })),
    default: loadConfig().defaultLicense ?? "MIT",
  }]);
  mergeConfig({ defaultLicense: license });
  console.log(c.success(`\n  ✔ License set to ${c.bold(licenseLabel(license))}.`));
  await pause();
}

async function handleSetAuthor(): Promise<void> {
  const cfg = loadConfig();
  const { author } = await inquirer.prompt<{ author: string }>([{
    type: "input",
    name: "author",
    message: "Author name (for copyright line):",
    default: cfg.projectAuthor ?? cfg.githubUsername ?? "",
  }]);
  mergeConfig({ projectAuthor: author.trim() || undefined });
  console.log(c.success(`\n  ✔ Author set to ${c.bold(author.trim() || "(cleared)")}.`));
  await pause();
}

async function handleToggleSection(key: keyof ReadmeSections): Promise<void> {
  const cfg = loadConfig();
  const sec = { ...(cfg.readmeSections ?? {}) };
  const defaults: Record<keyof ReadmeSections, boolean> = {
    screenshot: true, contributing: true, license: true, changelog: false, faq: false, starHistory: false,
  };
  const current = sec[key] ?? defaults[key];
  sec[key] = !current;
  mergeConfig({ readmeSections: sec });
  console.log(c.success(`\n  ✔ ${SECTION_LABELS[key]} turned ${sec[key] ? "ON" : "OFF"}.`));
  await pause(600);
}

async function handleSetOrg(): Promise<void> {
  const cfg = loadConfig();
  const choices: Choice[] = [{ name: "(personal account — no org)", value: "" }];

  // Try to fetch user's orgs if a token is saved
  if (cfg.githubToken) {
    try {
      const spin = spinner("Fetching your GitHub organizations…");
      const orgs = await listUserOrgs(cfg.githubToken);
      spin.stop();
      orgs.forEach((o) => choices.push({ name: o, value: o }));
    } catch {
      // silently skip — user can type manually
    }
  }

  choices.push({ name: "✏  Type org name manually", value: "__manual__" });

  const { picked } = await inquirer.prompt<{ picked: string }>([{
    type: "list",
    name: "picked",
    message: "Push repos to which GitHub org?",
    choices,
    pageSize: Math.min(choices.length, Math.max(10, (process.stdout.rows ?? 24) - 6)),
  }]);

  let org = picked;
  if (picked === "__manual__") {
    const { manual } = await inquirer.prompt<{ manual: string }>([{
      type: "input",
      name: "manual",
      message: "GitHub org name:",
      validate: (v: string) => v.trim().length > 0 || "Cannot be empty",
    }]);
    org = manual.trim();
  }

  mergeConfig({ defaultOrg: org || undefined });
  console.log(c.success(org ? `\n  ✔ Default org set to ${c.bold(org)}.` : "\n  ✔ Cleared — will push to personal account."));
  await pause();
}

async function handleSetBranch(): Promise<void> {
  const cfg = loadConfig();
  const { branch } = await inquirer.prompt<{ branch: string }>([{
    type: "input",
    name: "branch",
    message: "Default git branch name:",
    default: cfg.defaultBranch ?? "main",
    validate: (v: string) => /^[a-zA-Z0-9._/-]+$/.test(v.trim()) || "Invalid branch name",
  }]);
  mergeConfig({ defaultBranch: branch.trim() });
  console.log(c.success(`\n  ✔ Default branch set to ${c.bold(branch.trim())}.`));
  await pause();
}

async function handleToggleSsh(): Promise<void> {
  const cfg = loadConfig();
  const next = !cfg.useSshRemote;
  mergeConfig({ useSshRemote: next });
  console.log(c.success(`\n  ✔ Remote URL switched to ${c.bold(next ? "SSH" : "HTTPS")}.`));
  await pause();
}

async function handleResetAllPatterns(): Promise<void> {
  const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
    type: "confirm",
    name: "confirm",
    message: "Reset all file filter patterns to defaults?",
    default: false,
  }]);

  if (confirm) {
    const cfg = loadConfig();
    delete cfg.gitIncludePatterns;
    delete cfg.gitExcludePatterns;
    delete cfg.aiExcludePatterns;
    delete cfg.readmeExcludePatterns;
    saveConfig(cfg);
    console.log(c.success("\n  ✔ All patterns reset to defaults."));
    await pause();
  }
}

function pause(ms = 900): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Main TUI loop ────────────────────────────────────────────────────────────

export async function runConfigUI(): Promise<void> {
  // Non-interactive fallback (piped input, CI, etc.)
  if (!process.stdout.isTTY) {
    const cfg = loadConfig();
    console.log("Config file:", configFilePath());
    console.log("Anthropic key:", cfg.anthropicApiKey ? "saved" : "not set");
    console.log("Gemini key:", cfg.geminiApiKey ? "saved" : "not set");
    console.log("GitHub token:", cfg.githubToken ? `saved (@${cfg.githubUsername ?? "?"})` : "not set");
    console.log("Default provider:", cfg.defaultProvider ?? "anthropic");
    console.log("Default visibility:", cfg.defaultPrivate ? "private" : "public");
    console.log("Default org:", cfg.defaultOrg ?? "(personal account)");
    console.log("Default branch:", cfg.defaultBranch ?? "main");
    console.log("SSH remote:", cfg.useSshRemote ? "yes" : "no");
    console.log("Git include:", cfg.gitIncludePatterns?.join(", ") ?? "(all)");
    console.log("Git exclude:", cfg.gitExcludePatterns?.join(", ") ?? "(none)");
    console.log("AI exclude:", cfg.aiExcludePatterns?.join(", ") ?? "(defaults)");
    console.log("README exclude:", cfg.readmeExcludePatterns?.join(", ") ?? "(defaults)");
    return;
  }

  let activeTab: Tab = "ai-keys";

  while (true) {
    clearScreen();

    const cfg = loadConfig();
    printHeader(activeTab);

    // Render active tab content
    if (activeTab === "ai-keys") renderAiKeys(cfg);
    else if (activeTab === "github") renderGitHub(cfg);
    else if (activeTab === "defaults") renderDefaults(cfg);
    else if (activeTab === "readme") renderReadme(cfg);
    else renderFiles(cfg);

    // Build choices for this tab
    const choices =
      activeTab === "ai-keys"
        ? aiKeyChoices(cfg)
        : activeTab === "github"
          ? githubChoices(cfg)
          : activeTab === "defaults"
            ? defaultChoices(cfg)
            : activeTab === "readme"
              ? readmeChoices(cfg)
              : filesChoices(cfg);

    const termRows = process.stdout.rows ?? 24;
    const { action } = await inquirer.prompt<{ action: string }>([
      {
        type: "list",
        name: "action",
        message: "What would you like to do?",
        choices,
        pageSize: Math.min(choices.length, Math.max(10, termRows - 6)),
      },
    ]);

    // Navigation
    if (action === "__exit__") break;
    if (action.startsWith("__tab:")) {
      activeTab = action.slice(6) as Tab;
      continue;
    }

    // Clear screen before action so the action's output is readable
    clearScreen();
    console.log();

    // AI key actions
    if (action === "edit:anthropic") await handleEditKey("anthropic");
    else if (action === "edit:gemini") await handleEditKey("gemini");
    else if (action === "edit:openai") await handleEditKey("openai");
    else if (action === "clear:anthropic") await handleClearKey("anthropic");
    else if (action === "clear:gemini") await handleClearKey("gemini");
    else if (action === "clear:openai") await handleClearKey("openai");
    else if (action === "set:openai-model") await handleSetOpenAIModel();
    else if (action === "openai:oauth-login") { await runOpenAILogin(); await pause(); }
    // GitHub actions
    else if (action === "github:pat") await handleGitHubPat();
    else if (action === "github:oauth") await handleGitHubOAuth();
    else if (action === "github:validate") await handleValidateGitHubToken();
    else if (action === "github:clear") await handleClearGitHubToken();
    else if (action === "github:set-org") await handleSetOrg();
    else if (action === "github:clear-org") { mergeConfig({ defaultOrg: undefined }); console.log(c.success("\n  ✔ Org cleared.")); await pause(); }
    else if (action === "github:set-branch") await handleSetBranch();
    else if (action === "github:toggle-ssh") await handleToggleSsh();
    // Defaults actions
    else if (action.startsWith("set:provider:")) {
      await handleSetProvider(action.slice("set:provider:".length) as Provider);
    } else if (action === "toggle:private") await handleTogglePrivate();
    else if (action === "set:detail") await handleSetReadmeDetail();
    // Files actions
    else if (action.startsWith("files:edit:")) {
      await handleEditPatterns(action.slice("files:edit:".length) as PatternField);
    } else if (action === "files:reset") await handleResetAllPatterns();
    // README actions
    else if (action === "readme:toggle-vi") await handleToggleVi();
    else if (action === "readme:detail") await handleSetReadmeDetail();
    else if (action === "readme:license") await handleSetLicense();
    else if (action === "readme:author") await handleSetAuthor();
    else if (action.startsWith("readme:toggle:")) {
      await handleToggleSection(action.slice("readme:toggle:".length) as keyof ReadmeSections);
    }
  }

  clearScreen();
}

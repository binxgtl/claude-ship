import inquirer from "inquirer";
import { mergeConfig, resolveApiKey } from "./config.js";
import { resolveGitHubToken, validateGitHubToken } from "./github.js";
import { providerConsoleUrl, providerEnvVar, providerLabel } from "./providers.js";
import { printSuccess, printError, printWarning, printInfo, c } from "./ui.js";
import { type ReadmeResult } from "./readme.js";
import type { AppConfig, Provider, ReadmeDetail, ReadmeStyle } from "./types.js";

export async function resolveTokenAndUsername(flagToken?: string, savedUsername?: string): Promise<{ token: string; username: string }> {
  const token = await resolveGitHubToken(flagToken);
  if (savedUsername) {
    return { token, username: savedUsername };
  }
  try {
    const info = await validateGitHubToken(token);
    mergeConfig({ githubUsername: info.username });
    return { token, username: info.username };
  } catch {
    return { token, username: "" };
  }
}

export function validateProvider(raw: string): Provider {
  if (raw === "anthropic" || raw === "gemini" || raw === "openai" || raw === "ollama") return raw;
  throw new Error(`Unknown provider "${raw}". Use "anthropic", "gemini", "openai", or "ollama".`);
}

export function resolveFallback(primary: Provider, cfg: AppConfig): { provider: Provider; apiKey: string } | undefined {
  const candidates: Array<{ provider: Provider; key: string | undefined }> = [
    { provider: "anthropic", key: cfg.anthropicApiKey },
    { provider: "gemini", key: cfg.geminiApiKey },
    { provider: "openai", key: cfg.openaiApiKey },
  ];
  for (const c of candidates) {
    if (c.provider !== primary && c.key) return { provider: c.provider, apiKey: c.key };
  }
  return undefined;
}

export function printQuality(result: ReadmeResult): void {
  const score = result.qualityScore;
  const color = score >= 80 ? "green" : score >= 60 ? "yellow" : "red";
  const icon = score >= 80 ? "✔" : score >= 60 ? "⚠" : "✖";
  const line = `${icon} README quality: ${score}/100`;
  if (color === "green") printSuccess(line);
  else if (color === "yellow") printWarning(line);
  else printError(line);
  if (result.qualityIssues.length > 0) {
    for (const issue of result.qualityIssues) {
      console.log(`  ${c.dim("•")} ${issue}`);
    }
  }
  if (result.usedFallback) {
    printInfo("Primary provider failed — used fallback provider");
  }
}

export function resolveMaxTokens(flag?: string, configValue?: number): number | undefined {
  if (flag !== undefined) {
    const n = parseInt(flag, 10);
    return isNaN(n) ? undefined : n;
  }
  return configValue;
}

export function resolveDetail(flag: string | undefined, cfg: AppConfig): ReadmeDetail {
  const raw = flag ?? cfg.defaultReadmeDetail ?? "normal";
  if (raw === "short" || raw === "normal" || raw === "large" || raw === "carefully") return raw;
  throw new Error(`Unknown detail level "${raw}". Use: short, normal, large, carefully.`);
}

export function resolveStyle(flag: string | undefined, cfg: AppConfig): ReadmeStyle | undefined {
  if (!flag) return cfg.defaultReadmeStyle;
  if (flag === "practical" || flag === "balanced" || flag === "marketing") return flag;
  throw new Error(`Unknown style "${flag}". Use: practical, balanced, marketing.`);
}

export interface ResolvedProvider {
  provider: Provider;
  apiKey: string;
}

export async function ensureApiKey(
  provider: Provider,
  flagValue?: string
): Promise<string | undefined> {
  const result = await resolveProviderWithKey(provider, flagValue);
  return result?.apiKey;
}

export async function resolveProviderWithKey(
  provider: Provider,
  flagValue?: string
): Promise<ResolvedProvider | undefined> {
  if (provider === "ollama") return { provider, apiKey: "ollama" };

  const resolved = resolveApiKey(provider, flagValue);
  if (resolved) return { provider, apiKey: resolved };

  // Check if other providers have keys available
  const alternatives: { provider: Provider; label: string }[] = [];
  const allProviders: Provider[] = ["anthropic", "gemini", "openai", "ollama"];
  for (const alt of allProviders) {
    if (alt === provider) continue;
    const altKey = resolveApiKey(alt);
    if (altKey) alternatives.push({ provider: alt, label: providerLabel(alt) });
  }

  const label = providerLabel(provider);

  if (alternatives.length > 0) {
    console.log();
    printInfo(`No ${label} key found. Other providers available:`);
    const { action } = await inquirer.prompt<{ action: string }>([
      {
        type: "list",
        name: "action",
        message: "Choose an option:",
        choices: [
          ...alternatives.map((a) => ({
            name: `Switch to ${a.label}`,
            value: `switch:${a.provider}`,
          })),
          { name: `Enter ${label} API key manually`, value: "manual" },
          { name: "Skip AI generation", value: "skip" },
        ],
      },
    ]);

    if (action === "skip") return undefined;

    if (action.startsWith("switch:")) {
      const switched = action.slice(7) as Provider;
      if (switched === "ollama") return { provider: switched, apiKey: "ollama" };
      return { provider: switched, apiKey: resolveApiKey(switched)! };
    }
  } else {
    const consoleUrl = providerConsoleUrl(provider);
    const envVar = providerEnvVar(provider);
    const hint = provider === "openai"
      ? `\n  (Or run ${c.bold("npx @openai/codex login")} to use your ChatGPT subscription)`
      : "";
    console.log();
    printInfo(`No ${label} API key found. Get one at: ${c.path(consoleUrl)}`);
    console.log(c.dim(`  (Or set the ${envVar} environment variable to skip this prompt)${hint}\n`));
  }

  const { apiKey } = await inquirer.prompt<{ apiKey: string }>([
    {
      type: "password",
      name: "apiKey",
      message: `Enter your ${label} API key (blank = skip):`,
      mask: "*",
    },
  ]);

  if (!apiKey.trim()) return undefined;

  const keyMap: Partial<Record<Provider, keyof AppConfig>> = {
    anthropic: "anthropicApiKey",
    gemini: "geminiApiKey",
    openai: "openaiApiKey",
  };
  const configKey = keyMap[provider];
  if (configKey) mergeConfig({ [configKey]: apiKey.trim() } as Partial<AppConfig>);
  printSuccess(
    `API key saved to ~/.claudeship/config.json (AES-256 encrypted, machine-bound)`
  );
  console.log();

  return { provider, apiKey: apiKey.trim() };
}

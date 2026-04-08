import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { AppConfig, Provider } from "./types.js";

const CONFIG_DIR = path.join(os.homedir(), ".claudeship");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

// AES-256-CBC key derived from machine identity — makes the file useless if
// copied to another machine. Not a substitute for a system keychain, but
// meaningfully better than plaintext on disk.
function getMachineKey(): Buffer {
  const seed = `${os.hostname()}:${os.userInfo().username}:claude-ship-v1`;
  return crypto.createHash("sha256").update(seed).digest();
}

function encrypt(plaintext: string): string {
  const key = getMachineKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return "gcm:" + iv.toString("hex") + ":" + authTag.toString("hex") + ":" + encrypted.toString("hex");
}

function decrypt(ciphertext: string): string {
  const key = getMachineKey();

  if (ciphertext.startsWith("gcm:")) {
    const parts = ciphertext.slice(4).split(":");
    if (parts.length !== 3) throw new Error("Invalid GCM ciphertext format");
    const iv = Buffer.from(parts[0]!, "hex");
    const authTag = Buffer.from(parts[1]!, "hex");
    const encrypted = Buffer.from(parts[2]!, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  }

  const colonIdx = ciphertext.indexOf(":");
  if (colonIdx === -1) throw new Error("Invalid ciphertext format");
  const iv = Buffer.from(ciphertext.slice(0, colonIdx), "hex");
  const encrypted = Buffer.from(ciphertext.slice(colonIdx + 1), "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

// ─── Storage schema ───────────────────────────────────────────────────────────

// Fields stored encrypted
const ENCRYPTED_FIELDS: (keyof AppConfig)[] = [
  "anthropicApiKey",
  "geminiApiKey",
  "githubToken",
];

// Fields stored as plain JSON (not sensitive)
const PLAIN_FIELDS: (keyof AppConfig)[] = [
  "defaultProvider",
  "defaultPrivate",
  "githubUsername",
  "githubScopes",
  "oauthClientId",
  "gitIncludePatterns",
  "gitExcludePatterns",
  "aiExcludePatterns",
  "readmeExcludePatterns",
  "defaultOrg",
  "defaultBranch",
  "useSshRemote",
  "defaultReadmeDetail",
  "defaultLicense",
  "projectAuthor",
  "readmeSections",
  "defaultVi",
  "defaultReadmeStyle",
  "maxReadmeTokens",
];

interface StoredConfig {
  _enc?: Record<string, string>;
  _settings?: Record<string, unknown>;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function loadConfig(): AppConfig {
  if (!fs.existsSync(CONFIG_FILE)) return {};

  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf8");
    const stored: StoredConfig = JSON.parse(raw);
    const enc = stored._enc ?? {};
    const settings = stored._settings ?? {};
    const config: AppConfig = {};

    for (const field of ENCRYPTED_FIELDS) {
      const val = enc[field as string];
      if (val) {
        try {
          (config as Record<string, unknown>)[field] = decrypt(val);
        } catch {
          // Encrypted on a different machine — skip silently
        }
      }
    }

    for (const field of PLAIN_FIELDS) {
      const val = settings[field as string];
      if (val !== undefined) {
        (config as Record<string, unknown>)[field] = val;
      }
    }

    return config;
  } catch {
    return {};
  }
}

export function saveConfig(config: AppConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });

  const enc: Record<string, string> = {};
  const settings: Record<string, unknown> = {};

  for (const field of ENCRYPTED_FIELDS) {
    const val = (config as Record<string, unknown>)[field];
    if (typeof val === "string" && val) enc[field as string] = encrypt(val);
  }

  for (const field of PLAIN_FIELDS) {
    const val = (config as Record<string, unknown>)[field];
    if (val !== undefined) settings[field as string] = val;
  }

  const stored: StoredConfig = { _enc: enc, _settings: settings };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(stored, null, 2), {
    encoding: "utf8",
    mode: 0o600, // owner-only on POSIX; no-op on Windows (encryption is the real guard there)
  });
}

export function mergeConfig(partial: Partial<AppConfig>): void {
  const existing = loadConfig();
  saveConfig({ ...existing, ...partial });
}

export function clearConfigField(field: keyof AppConfig): void {
  const existing = loadConfig();
  delete existing[field];
  saveConfig(existing);
}

/** Resolve an AI API key: flag → env → saved config */
export function resolveApiKey(
  provider: "anthropic" | "gemini",
  flagValue?: string
): string | undefined {
  if (flagValue) return flagValue;
  if (provider === "anthropic") {
    return process.env["ANTHROPIC_API_KEY"] ?? loadConfig().anthropicApiKey;
  }
  return (
    process.env["GEMINI_API_KEY"] ??
    process.env["GOOGLE_API_KEY"] ??
    loadConfig().geminiApiKey
  );
}

/** Resolve the default AI provider from config, defaulting to anthropic */
export function resolveDefaultProvider(): Provider {
  return loadConfig().defaultProvider ?? "anthropic";
}

export function configFilePath(): string {
  return CONFIG_FILE;
}

export function configDirPath(): string {
  return CONFIG_DIR;
}

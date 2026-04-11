import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import os from "os";
import path from "path";
import { Provider } from "./types.js";
import { loadConfig } from "./config.js";

export interface ProviderRequest {
  provider: Provider;
  apiKey: string;
  prompt: string;
  maxTokens?: number;
  onChunk?: (chunk: string) => void;
}

/**
 * Unified text generation — returns the raw model text response.
 * When onChunk is provided, streams output and calls onChunk with each piece.
 * Anthropic: claude-sonnet-4-6
 * Gemini:    gemini-3-flash-preview
 * OpenAI:    gpt-4o
 * Ollama:    configurable (default: llama3.1)
 */
export async function generateText(req: ProviderRequest): Promise<string> {
  if (req.provider === "anthropic") {
    return req.onChunk ? streamWithAnthropic(req) : generateWithAnthropic(req);
  }
  if (req.provider === "openai") {
    return req.onChunk ? streamWithOpenAI(req) : generateWithOpenAI(req);
  }
  if (req.provider === "ollama") {
    return req.onChunk ? streamWithOllama(req) : generateWithOllama(req);
  }
  return req.onChunk ? streamWithGemini(req) : generateWithGemini(req);
}

async function generateWithAnthropic(req: ProviderRequest): Promise<string> {
  const client = new Anthropic({ apiKey: req.apiKey });

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: req.maxTokens ?? 2048,
    messages: [{ role: "user", content: req.prompt }],
  });

  const block = message.content[0];
  if (block.type !== "text") throw new Error("Unexpected Anthropic response type");
  return block.text;
}

async function streamWithAnthropic(req: ProviderRequest): Promise<string> {
  const client = new Anthropic({ apiKey: req.apiKey });

  const stream = client.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: req.maxTokens ?? 2048,
    messages: [{ role: "user", content: req.prompt }],
  });

  const chunks: string[] = [];
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      const text = event.delta.text;
      chunks.push(text);
      req.onChunk!(text);
    }
  }
  return chunks.join("");
}

async function generateWithGemini(req: ProviderRequest): Promise<string> {
  const { GoogleGenAI } = await import("@google/genai").catch(() => {
    throw new Error(
      "Missing dependency for Gemini provider.\n" +
        "Run: npm install @google/genai\n" +
        "Or use --provider anthropic instead."
    );
  });

  const ai = new GoogleGenAI({ apiKey: req.apiKey });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: req.prompt,
  });

  const text = response.text;
  if (!text) throw new Error("Empty response from Gemini API");
  return text;
}

async function streamWithGemini(req: ProviderRequest): Promise<string> {
  const { GoogleGenAI } = await import("@google/genai").catch(() => {
    throw new Error(
      "Missing dependency for Gemini provider.\n" +
        "Run: npm install @google/genai\n" +
        "Or use --provider anthropic instead."
    );
  });

  const ai = new GoogleGenAI({ apiKey: req.apiKey });
  const response = await ai.models.generateContentStream({
    model: "gemini-3-flash-preview",
    contents: req.prompt,
  });

  const chunks: string[] = [];
  for await (const chunk of response) {
    const text = chunk.text ?? "";
    if (text) {
      chunks.push(text);
      req.onChunk!(text);
    }
  }
  return chunks.join("");
}

// ─── OpenAI (Codex OAuth + API key fallback) ────────────────────────────────

const OPENAI_DEFAULT_MODEL = "gpt-5.4";

function openaiModel(): string {
  return loadConfig().openaiModel ?? OPENAI_DEFAULT_MODEL;
}
const OPENAI_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";

interface CodexAuth {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export function findCodexAuthFile(): string | null {
  const candidates = [
    // claude-ship's own token (highest priority)
    path.join(os.homedir(), ".claudeship", "openai-auth.json"),
    // codex CLI / chatgpt-local fallbacks
    process.env["CHATGPT_LOCAL_HOME"] && path.join(process.env["CHATGPT_LOCAL_HOME"], "auth.json"),
    process.env["CODEX_HOME"] && path.join(process.env["CODEX_HOME"], "auth.json"),
    path.join(os.homedir(), ".chatgpt-local", "auth.json"),
    path.join(os.homedir(), ".codex", "auth.json"),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function readCodexAuth(): CodexAuth | null {
  const authFile = findCodexAuthFile();
  if (!authFile) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(authFile, "utf8"));
    // Nested format (official codex CLI): { tokens: { access_token, ... } }
    const tokens = raw.tokens ?? raw;
    if (tokens.access_token && tokens.refresh_token) {
      return {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at ?? raw.expires_at ?? 0,
      };
    }
  } catch { /* unreadable */ }
  return null;
}

async function refreshCodexToken(auth: CodexAuth): Promise<CodexAuth> {
  const isExpired = Date.now() / 1000 > auth.expires_at - 60;
  if (!isExpired) return auth;

  const response = await fetch(OPENAI_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: auth.refresh_token,
      client_id: OPENAI_OAUTH_CLIENT_ID,
    }),
  });

  if (!response.ok) {
    throw new Error(`OAuth token refresh failed (${response.status}). Run: npx @openai/codex login`);
  }

  const data = await response.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  const refreshed: CodexAuth = {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? auth.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
  };

  const authFile = findCodexAuthFile();
  if (authFile) {
    try {
      const existing = JSON.parse(fs.readFileSync(authFile, "utf8"));
      // Preserve original format: nested (codex CLI) or flat
      if (existing.tokens) {
        existing.tokens.access_token = refreshed.access_token;
        existing.tokens.refresh_token = refreshed.refresh_token;
        existing.last_refresh = new Date().toISOString();
        fs.writeFileSync(authFile, JSON.stringify(existing, null, 2), "utf8");
      } else {
        fs.writeFileSync(authFile, JSON.stringify(refreshed, null, 2), "utf8");
      }
    } catch { /* skip */ }
  }

  return refreshed;
}

async function resolveOpenAIAuth(apiKey: string): Promise<{ token: string; baseUrl: string; useCodex: boolean }> {
  if (apiKey && apiKey !== "codex-oauth" && apiKey.startsWith("sk-")) {
    return { token: apiKey, baseUrl: "https://api.openai.com/v1", useCodex: false };
  }

  const auth = readCodexAuth();
  if (!auth) {
    throw new Error(
      "No OpenAI Codex OAuth tokens found.\n" +
      "Login first:  npx @openai/codex login\n" +
      "Or provide an API key:  --api-key sk-..."
    );
  }

  const refreshed = await refreshCodexToken(auth);
  return { token: refreshed.access_token, baseUrl: CODEX_BASE_URL, useCodex: true };
}

async function generateWithOpenAI(req: ProviderRequest): Promise<string> {
  const { token, baseUrl, useCodex } = await resolveOpenAIAuth(req.apiKey);

  // Codex API requires streaming — use streamWithOpenAI and collect
  if (useCodex) {
    return streamWithOpenAI({ ...req, onChunk: req.onChunk ?? (() => {}) });
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: openaiModel(),
      max_tokens: req.maxTokens ?? 2048,
      stream: false,
      messages: [{ role: "user", content: req.prompt }],
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${body}`);
  }
  const json = await response.json() as { choices: Array<{ message: { content: string } }> };
  return json.choices[0]?.message?.content ?? "";
}

async function streamWithOpenAI(req: ProviderRequest): Promise<string> {
  const { token, baseUrl, useCodex } = await resolveOpenAIAuth(req.apiKey);

  const url = useCodex ? `${baseUrl}/responses` : `${baseUrl}/chat/completions`;
  const body = useCodex
    ? { model: openaiModel(), instructions: "", input: [{ role: "user", content: req.prompt }], stream: true, store: false }
    : { model: openaiModel(), max_tokens: req.maxTokens ?? 2048, stream: true, messages: [{ role: "user", content: req.prompt }] };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${errBody}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body from OpenAI");
  const decoder = new TextDecoder();
  const chunks: string[] = [];

  let buf = "";
  let lastEvent = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        lastEvent = line.slice(7).trim();
        continue;
      }
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
      try {
        const parsed = JSON.parse(line.slice(6));
        if (useCodex) {
          if (lastEvent === "response.output_text.delta" && typeof parsed.delta === "string") {
            chunks.push(parsed.delta);
            req.onChunk!(parsed.delta);
          }
        } else {
          const text = parsed.choices?.[0]?.delta?.content;
          if (text) { chunks.push(text); req.onChunk!(text); }
        }
      } catch { /* skip */ }
    }
  }
  return chunks.join("");
}

// ─── Ollama ──────────────────────────────────────────────────────────────────

function ollamaConfig(): { baseUrl: string; model: string } {
  const cfg = loadConfig();
  return {
    baseUrl: cfg.ollamaBaseUrl ?? "http://localhost:11434",
    model: cfg.ollamaModel ?? "llama3.1",
  };
}

async function generateWithOllama(req: ProviderRequest): Promise<string> {
  const { baseUrl, model } = ollamaConfig();
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: req.prompt, stream: false }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama error ${response.status}: ${body}`);
  }
  const json = await response.json() as { response: string };
  if (!json.response) throw new Error("Empty response from Ollama");
  return json.response;
}

async function streamWithOllama(req: ProviderRequest): Promise<string> {
  const { baseUrl, model } = ollamaConfig();
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: req.prompt, stream: true }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama error ${response.status}: ${body}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body from Ollama");
  const decoder = new TextDecoder();
  const chunks: string[] = [];

  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as { response?: string; done?: boolean };
        if (parsed.response) { chunks.push(parsed.response); req.onChunk!(parsed.response); }
      } catch { /* skip */ }
    }
  }
  return chunks.join("");
}

// ─── Provider metadata ───────────────────────────────────────────────────────

export function providerLabel(provider: Provider): string {
  switch (provider) {
    case "anthropic": return "Claude Sonnet 4.6";
    case "gemini": return "Gemini 3 Flash";
    case "openai": return `${openaiModel()} (Codex)`;
    case "ollama": return `Ollama (${ollamaConfig().model})`;
  }
}

export function providerEnvVar(provider: Provider): string {
  switch (provider) {
    case "anthropic": return "ANTHROPIC_API_KEY";
    case "gemini": return "GEMINI_API_KEY";
    case "openai": return "OPENAI_API_KEY (or Codex OAuth)";
    case "ollama": return "(no key needed)";
  }
}

export function providerConsoleUrl(provider: Provider): string {
  switch (provider) {
    case "anthropic": return "https://console.anthropic.com";
    case "gemini": return "https://aistudio.google.com/app/apikey";
    case "openai": return "https://platform.openai.com/api-keys (or: npx @openai/codex login)";
    case "ollama": return "https://ollama.com";
  }
}

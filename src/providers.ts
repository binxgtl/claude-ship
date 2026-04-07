import Anthropic from "@anthropic-ai/sdk";
import { Provider } from "./types.js";

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
 */
export async function generateText(req: ProviderRequest): Promise<string> {
  if (req.provider === "anthropic") {
    return req.onChunk ? streamWithAnthropic(req) : generateWithAnthropic(req);
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

export function providerLabel(provider: Provider): string {
  return provider === "anthropic" ? "Claude Sonnet 4.6" : "Gemini 3 Flash";
}

export function providerEnvVar(provider: Provider): string {
  return provider === "anthropic" ? "ANTHROPIC_API_KEY" : "GEMINI_API_KEY";
}

export function providerConsoleUrl(provider: Provider): string {
  return provider === "anthropic"
    ? "https://console.anthropic.com"
    : "https://aistudio.google.com/app/apikey";
}

import Anthropic from "@anthropic-ai/sdk";
import { Provider } from "./types.js";

export interface ProviderRequest {
  provider: Provider;
  apiKey: string;
  prompt: string;
  maxTokens?: number;
}

/**
 * Unified text generation — returns the raw model text response.
 * Anthropic: claude-3-5-sonnet-20241022
 * Gemini:    gemini-3-flash-preview
 */
export async function generateText(req: ProviderRequest): Promise<string> {
  if (req.provider === "anthropic") {
    return generateWithAnthropic(req);
  }
  return generateWithGemini(req);
}

async function generateWithAnthropic(req: ProviderRequest): Promise<string> {
  const client = new Anthropic({ apiKey: req.apiKey });

  const message = await client.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: req.maxTokens ?? 2048,
    messages: [{ role: "user", content: req.prompt }],
  });

  const block = message.content[0];
  if (block.type !== "text") throw new Error("Unexpected Anthropic response type");
  return block.text;
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

export function providerLabel(provider: Provider): string {
  return provider === "anthropic" ? "Claude 3.5 Sonnet" : "Gemini 3 Flash";
}

export function providerEnvVar(provider: Provider): string {
  return provider === "anthropic" ? "ANTHROPIC_API_KEY" : "GEMINI_API_KEY";
}

export function providerConsoleUrl(provider: Provider): string {
  return provider === "anthropic"
    ? "https://console.anthropic.com"
    : "https://aistudio.google.com/app/apikey";
}

import { describe, it, expect } from "vitest";
import { parseClaudeResponse } from "../parser.js";

describe("parseClaudeResponse — path safety", () => {
  it("rejects traversal in first-line strategy", () => {
    const input = "```ts\n../escape.ts\nexport const x = 1;\n```";
    const { files } = parseClaudeResponse(input);
    expect(files.every((f) => !f.path.includes(".."))).toBe(true);
    expect(files.find((f) => f.path === "escape.ts")).toBeUndefined();
  });

  it("rejects traversal in comment strategy", () => {
    const input = "```ts\n// ../escape.ts\nexport const x = 1;\n```";
    const { files } = parseClaudeResponse(input);
    expect(files.every((f) => !f.path.includes(".."))).toBe(true);
  });

  it("rejects absolute paths", () => {
    const input = "```ts\n/etc/passwd\ncontent\n```";
    const { files } = parseClaudeResponse(input);
    expect(files.find((f) => f.path.startsWith("/"))).toBeUndefined();
  });

  it("accepts normal relative paths", () => {
    const input = "```ts\nsrc/index.ts\nexport const x = 1;\n```";
    const { files } = parseClaudeResponse(input);
    expect(files.find((f) => f.path === "src/index.ts")).toBeDefined();
  });

  it("deduplicates files keeping longer content", () => {
    const input = [
      "```ts\nsrc/a.ts\nshort\n```",
      "```ts\nsrc/a.ts\nthis is longer content\n```",
    ].join("\n");
    const { files } = parseClaudeResponse(input);
    expect(files.filter((f) => f.path === "src/a.ts")).toHaveLength(1);
    expect(files.find((f) => f.path === "src/a.ts")?.content).toBe("this is longer content");
  });
});

import { ParsedFile, ParseResult } from "./types.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawFence {
  lang: string;
  body: string;
  /** Up to 8 lines of text immediately before this fence */
  textBefore: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LANGUAGE_EXTENSIONS: Record<string, string[]> = {
  typescript: ["ts", "tsx"],
  javascript: ["js", "jsx", "mjs", "cjs"],
  python: ["py"],
  rust: ["rs"],
  go: ["go"],
  java: ["java"],
  css: ["css"],
  scss: ["scss", "sass"],
  html: ["html", "htm"],
  json: ["json"],
  yaml: ["yml", "yaml"],
  toml: ["toml"],
  markdown: ["md", "mdx"],
  bash: ["sh", "bash"],
  sql: ["sql"],
  graphql: ["graphql", "gql"],
  prisma: ["prisma"],
  dockerfile: [],
};

// Config/manifest files that have no extension but are valid paths
const EXTENSIONLESS_FILES = new Set([
  "Dockerfile",
  "Makefile",
  "Procfile",
  ".env.example",
  ".env.local",
  ".eslintignore",
  ".prettierignore",
  ".gitignore",
  ".dockerignore",
]);

// Phrases that look like paths but are actually prose — reject them
const PROSE_REJECT_PATTERNS = [
  /\s{2,}/,        // multiple spaces → sentence fragment
  /[,;!?'"]/,      // punctuation typical in prose
  /^\d+\./,        // numbered list item ("1. Install...")
  /^-\s/,          // bullet point
  /^Here/i,
  /^Note:/i,
  /^This/i,
  /^The /i,
  /^Create/i,
  /^Update/i,
  /^Add /i,
];

// ─── Pre-processing ───────────────────────────────────────────────────────────

/**
 * Strip Claude Code <antArtifact> wrappers and normalise line endings.
 * Returns modified text + any files found directly in artifact tags.
 */
function preProcess(raw: string): { text: string; artifacts: ParsedFile[] } {
  const artifacts: ParsedFile[] = [];

  // Handle antArtifact tags (Claude Code desktop / API streaming)
  const artifactRe =
    /<antArtifact[^>]*?\btitle="([^"]+)"[^>]*?>([\s\S]*?)<\/antArtifact>/gi;
  let match: RegExpExecArray | null;
  while ((match = artifactRe.exec(raw)) !== null) {
    const title = match[1].trim();
    const content = match[2].trim();
    if (isValidPath(title)) {
      artifacts.push({
        path: normalizePath(title),
        content,
        language: inferLanguageFromPath(title),
      });
    }
  }

  // Strip the tags so the fence extractor doesn't double-count them
  const text = raw
    .replace(/<antArtifact[^>]*?>([\s\S]*?)<\/antArtifact>/gi, "$1")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  return { text, artifacts };
}

// ─── State-machine fence extractor ───────────────────────────────────────────

/**
 * Walk the text line-by-line, collect every fenced code block with
 * the surrounding context lines. Handles 3- and 4-backtick fences,
 * nested blocks, and long prose paragraphs between blocks.
 */
function extractFences(text: string): RawFence[] {
  const lines = text.split("\n");
  const fences: RawFence[] = [];
  let i = 0;
  const contextLines: string[] = [];

  while (i < lines.length) {
    const line = lines[i]!;

    // Opening fence: 3 or 4 backticks at start of line, optional lang hint
    const openMatch = line.match(/^(`{3,4})(\w*)\s*$/);
    if (openMatch) {
      const backticks = openMatch[1]!;
      const lang = openMatch[2] ?? "";
      const bodyLines: string[] = [];
      i++;

      // Collect until matching closing fence (same backtick count)
      while (i < lines.length && lines[i] !== backticks) {
        bodyLines.push(lines[i]!);
        i++;
      }
      i++; // skip closing fence line

      fences.push({
        lang,
        body: bodyLines.join("\n"),
        textBefore: contextLines.slice(-8).join("\n"),
      });

      contextLines.length = 0; // reset context after a fence
    } else {
      contextLines.push(line);
      i++;
    }
  }

  return fences;
}

// ─── Path validation & normalisation ─────────────────────────────────────────

function isValidPath(candidate: string): boolean {
  const s = candidate.trim();
  if (!s || s.length > 250) return false;

  // Reject absolute paths and traversal segments before any other check
  const normalized = s.replace(/\\/g, "/");
  if (normalized.startsWith("/")) return false;
  if (normalized.split("/").some((seg) => seg === "..")) return false;

  // Must end with a known extension OR be an extensionless config file
  const hasExtension = /\.[a-zA-Z0-9]{1,12}$/.test(s);
  if (!hasExtension && !EXTENSIONLESS_FILES.has(s.split("/").pop() ?? "")) return false;

  // Reject prose patterns
  for (const re of PROSE_REJECT_PATTERNS) {
    if (re.test(s)) return false;
  }

  // Must only contain path-safe characters
  if (!/^[a-zA-Z0-9._\-/\\@~+:]+$/.test(s)) return false;

  // Reject paths that look like URLs
  if (/^https?:\/\//.test(s)) return false;

  return true;
}

function normalizePath(filePath: string): string {
  return filePath
    .trim()
    .replace(/\\/g, "/")
    .replace(/\s+/g, "-")
    .replace(/^\/+/, "")   // strip any leading slash
    .replace(/\/+/g, "/"); // collapse double slashes
}

function inferLanguageFromPath(filePath: string): string {
  const name = filePath.split("/").pop() ?? "";
  // Extensionless files
  if (name === "Dockerfile") return "dockerfile";
  if (name === "Makefile") return "makefile";

  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  for (const [lang, exts] of Object.entries(LANGUAGE_EXTENSIONS)) {
    if ((exts as string[]).includes(ext)) return lang;
  }
  return ext;
}

// ─── File extraction from a single fence ─────────────────────────────────────

function fileFromFence(fence: RawFence): ParsedFile | null {
  const bodyLines = fence.body.split("\n");
  const firstLine = (bodyLines[0] ?? "").trim();

  // Strategy 1 — first line of block is a bare file path
  if (isValidPath(firstLine)) {
    return {
      path: normalizePath(firstLine),
      content: bodyLines.slice(1).join("\n").trimEnd(),
      language: fence.lang || inferLanguageFromPath(firstLine),
    };
  }

  // Strategy 2 — first line is a // or # comment with the path
  const commentMatch = firstLine.match(/^(?:\/\/|#)\s+(.+)$/);
  if (commentMatch) {
    const candidate = (commentMatch[1] ?? "").trim();
    if (isValidPath(candidate)) {
      return {
        path: normalizePath(candidate),
        content: bodyLines.slice(1).join("\n").trimEnd(),
        language: fence.lang || inferLanguageFromPath(candidate),
      };
    }
  }

  // Strategy 3 — text before fence contains a label (bold path, "file:", emoji)
  //   Examples:
  //     **`src/components/Button.tsx`**
  //     ### `src/utils/api.ts`
  //     📁 app/page.tsx
  //     File: src/index.ts
  const labelRe =
    /(?:^|\n)(?:\*{1,2}`?|#{1,3}\s*`?|📁\s*|[Ff]ile:\s*`?)([a-zA-Z0-9._\-/\\@]+\.[a-zA-Z0-9]{1,12})`?\*{0,2}\s*$/;
  const labelMatch = fence.textBefore.match(labelRe);
  if (labelMatch) {
    const candidate = (labelMatch[1] ?? "").trim();
    if (isValidPath(candidate)) {
      return {
        path: normalizePath(candidate),
        content: fence.body.trimEnd(),
        language: fence.lang || inferLanguageFromPath(candidate),
      };
    }
  }

  return null;
}

// ─── Deduplication ────────────────────────────────────────────────────────────

function deduplicateFiles(files: ParsedFile[]): ParsedFile[] {
  const seen = new Map<string, ParsedFile>();
  for (const file of files) {
    const existing = seen.get(file.path);
    // Keep the version with more content (more complete)
    if (!existing || file.content.length > existing.content.length) {
      seen.set(file.path, file);
    }
  }
  return Array.from(seen.values());
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function parseClaudeResponse(response: string): ParseResult {
  const { text, artifacts } = preProcess(response);
  const fences = extractFences(text);

  const extracted: ParsedFile[] = [...artifacts];

  for (const fence of fences) {
    const file = fileFromFence(fence);
    if (file) extracted.push(file);
  }

  const totalFences = fences.length;

  return {
    files: deduplicateFiles(extracted),
    rawBlocks: totalFences,
  };
}

export function buildFileTree(files: ParsedFile[]): string {
  // Build a set of all node paths (both files and their ancestor dirs)
  const nodes = new Map<string, "file" | "dir">();

  for (const f of files) {
    const parts = f.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      nodes.set(parts.slice(0, i).join("/"), "dir");
    }
    nodes.set(f.path, "file");
  }

  const lines: string[] = ["."];

  const renderDir = (parentPath: string, prefix: string) => {
    const children = Array.from(nodes.entries())
      .filter(([p]) => {
        const parent = p.includes("/") ? p.substring(0, p.lastIndexOf("/")) : "";
        return parent === parentPath;
      })
      .sort(([a, aT], [b, bT]) => {
        // dirs before files, then alphabetical
        if (aT !== bT) return aT === "dir" ? -1 : 1;
        return a.localeCompare(b);
      });

    children.forEach(([nodePath, nodeType], idx) => {
      const name = nodePath.split("/").pop()!;
      const isLast = idx === children.length - 1;
      lines.push(`${prefix}${isLast ? "└── " : "├── "}${name}`);
      if (nodeType === "dir") {
        renderDir(nodePath, prefix + (isLast ? "    " : "│   "));
      }
    });
  };

  renderDir("", "");
  return lines.join("\n");
}

import { TechStack, Provider, ReadmeDetail, ReadmeStyle, LicenseType, ReadmeSections } from "./types.js";
import { renderBadges } from "./detector.js";
import { generateText, providerLabel } from "./providers.js";
import { ReadmeContext } from "./scaffold.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReadmeOptions {
  projectName: string;
  description: string;
  stack: TechStack;
  /** All project files — caller should pre-filter with filterFilesForReadme() */
  files: string[];
  context: ReadmeContext;
  vietnamese?: boolean;
  detail?: ReadmeDetail;
  license?: LicenseType;
  /** Author name for copyright line */
  author?: string;
  sections?: ReadmeSections;
  /** GitHub username — used for star history chart URL */
  githubUsername?: string;
  /** Override max output tokens. 0 = use provider maximum (no artificial limit). */
  maxTokens?: number;
  /** Tone/format style. practical = code-first terse; balanced = default; marketing = narrative */
  style?: ReadmeStyle;
  provider: Provider;
  apiKey: string;
}

// ─── Screenshot placeholder ───────────────────────────────────────────────────

const SCREENSHOT_PLACEHOLDER = `<!-- Add a screenshot or GIF demo here
     Tip: record with vhs (https://github.com/charmbracelet/vhs) or licecap
     ![Demo](./docs/demo.gif) -->`;

// ─── Style instruction ───────────────────────────────────────────────────────

function styleInstruction(style: ReadmeStyle | undefined): string {
  switch (style) {
    case "practical":
      return `STYLE: practical — terse, code-first. Lead every section with a command or code example, not prose. One sentence max per explanation. No marketing copy, no adjectives like "powerful/seamless/robust". Every sentence must state a fact or show a command.`;
    case "marketing":
      return `STYLE: marketing — engaging narrative. Lead with benefits and developer experience. Use vivid language to explain value. Keep it accurate but sell the project.`;
    default:
      return `STYLE: balanced — professional docs tone. Mix brief explanations with code examples. Factual, no hype.`;
  }
}

// ─── Output sanitizer & quality gate ─────────────────────────────────────────

// Matches <placeholder> patterns but not HTML comments (<!-- ... -->)
const LEAKED_PLACEHOLDER_RE = /<(?!(?:!--|\/?\w+(?:\s[^>]*)?>))[^>]{1,80}>/g;

const HEDGE_RE = /\b(possibly|potentially|likely|probably|might be|may be|could be)\b/gi;

const GENERIC_MARKETING_RE =
  /\b(powerful|seamless|robust|comprehensive|cutting-edge|state-of-the-art|user-friendly|easy to use|highly optimized)\b/gi;

interface SanitizeResult {
  text: string;
  /** 0–100. Lower = more issues detected. */
  score: number;
  issues: string[];
}

function sanitizeOutput(text: string, ctx: ReadmeContext): SanitizeResult {
  const issues: string[] = [];
  let clean = text;

  // 1. Strip leaked <placeholder> tokens (real ones, not HTML comments or tags)
  const leaks = [...text.matchAll(LEAKED_PLACEHOLDER_RE)].map((m) => m[0]);
  if (leaks.length > 0) {
    // Only remove lines that are *only* a placeholder (avoids breaking inline HTML)
    clean = clean
      .split("\n")
      .map((line) => (LEAKED_PLACEHOLDER_RE.test(line.trim()) ? "" : line))
      .join("\n");
    // Reset lastIndex after global test
    LEAKED_PLACEHOLDER_RE.lastIndex = 0;
    clean = clean.replace(/\n{3,}/g, "\n\n");
    issues.push(`${leaks.length} placeholder line(s) stripped: ${leaks.slice(0, 3).join(", ")}`);
  }

  // 2. Count hedging phrases (penalise score; don't remove — may be in code examples)
  const hedgeMatches = text.match(HEDGE_RE) ?? [];
  if (hedgeMatches.length > 0) {
    issues.push(`${hedgeMatches.length} hedging phrase(s): ${[...new Set(hedgeMatches)].join(", ")}`);
  }

  // 3. Count generic marketing words
  const genericMatches = text.match(GENERIC_MARKETING_RE) ?? [];
  if (genericMatches.length > 2) {
    issues.push(`${genericMatches.length} generic marketing words`);
  }

  // 4. Check for hallucinated env var names (ALL_CAPS ending in _KEY/_TOKEN/_SECRET/_URL
  //    that are not in the known envVars list)
  if (ctx.envVars.length > 0) {
    const envRe = /\b([A-Z][A-Z0-9_]{3,}(?:_KEY|_TOKEN|_SECRET|_URL))\b/g;
    const mentioned = new Set([...text.matchAll(envRe)].map((m) => m[1]!));
    const known = new Set(ctx.envVars);
    const hallucinated = [...mentioned].filter((v) => !known.has(v));
    if (hallucinated.length > 0) {
      issues.push(`Possible hallucinated env vars: ${hallucinated.join(", ")}`);
    }
  }

  const score = Math.max(
    0,
    100 -
      leaks.length * 15 -
      Math.min(hedgeMatches.length * 4, 20) -
      Math.min(genericMatches.length * 3, 15)
  );

  return { text: clean.trim(), score, issues };
}

function stricterPromptSuffix(): string {
  return `\n\n## REGEN — previous attempt had quality issues. STRICT mode:
- Remove ALL <placeholder> tokens. If you don't know a value, omit the row/bullet entirely.
- No hedging: remove "possibly", "likely", "potentially", "might be", "may be".
- No generic adjectives: "powerful", "seamless", "robust", "comprehensive", "cutting-edge".
- Every command must be real and runnable. Every env var must be from the list above.`;
}

// ─── English prompt ───────────────────────────────────────────────────────────

function buildEnglishPrompt(opts: ReadmeOptions): string {
  const detail = opts.detail ?? "normal";
  const badges = renderBadges(opts.stack.badges);
  const techList = [...opts.stack.frameworks, ...opts.stack.languages].join(", ");
  const fileList = opts.files.slice(0, 50).join("\n");
  const contextSection = buildContextSection(opts.context);
  const usageSection = buildUsageHints(opts.context);
  const structure = buildStructureSpec(detail, opts, false);
  const maxTokenHint = detail === "short" ? 1200 : detail === "normal" ? 2000 : detail === "large" ? 4000 : 7000;

  const styleLine = styleInstruction(opts.style);

  return `You are a senior software engineer writing a production-quality GitHub README.md.
Your goal: make developers immediately understand this project and want to use it.
Detail level: ${detail.toUpperCase()} — target output ~${maxTokenHint} tokens.
${styleLine}

## CRITICAL RULES — violating any of these is a failure
1. Use proper Markdown heading syntax with # symbols. NEVER omit them.
   - H1: # Title  |  H2: ## Section  |  H3: ### Subsection
   WRONG: "✨ Features"       RIGHT: "## ✨ Features"
   WRONG: "Getting Started"  RIGHT: "## 🚀 Getting Started"
2. Output ONLY raw Markdown. No explanations before or after. No surrounding code fences.
3. Do NOT add a Table of Contents.
4. Do NOT invent features, CLI flags, subcommands, or environment variables not visible in the provided code.
5. Do NOT invent config file paths — only mention paths that appear in the source code.
6. Architecture/file descriptions: write ONLY what the provided source snippets show. Do NOT infer functionality from file names or general conventions about similar tools.
7. Commander.js \`.name("x")\` sets the program name — it is NOT a subcommand. Only \`.command("x")\` defines subcommands. Do NOT list "name" as a command unless it appears as \`.command("name")\` in the source.
8. Environment variables: list ONLY those from the "CLI / runtime info" section above. Do NOT add rows like "VAR_NAME" or any placeholder — if you don't know a variable name, skip it entirely.
9. Tech Stack: list ONLY direct dependencies from package.json/Cargo.toml/etc. Do NOT list implicit/transitive packages (e.g. esbuild inside tsx, rollup inside vite).${opts.context.hasTests ? "" : "\n10. This project has NO test suite — do NOT mention running tests, writing tests, or test commands anywhere."}

## Project information
- Name: ${opts.projectName}
- Description: ${opts.description}
- Tech stack: ${opts.stack.name} (${techList})
- Package manager: ${opts.stack.packageManager}
${usageSection}${contextSection}
## All project files
${fileList}

## Shields.io badges (copy verbatim into title section)
${badges || "(no badges)"}

${structure}`;
}

// ─── Vietnamese prompt ────────────────────────────────────────────────────────

function buildVietnamesePrompt(opts: ReadmeOptions): string {
  const detail = opts.detail ?? "normal";
  const badges = renderBadges(opts.stack.badges);
  const techList = [...opts.stack.frameworks, ...opts.stack.languages].join(", ");
  const fileList = opts.files.slice(0, 50).join("\n");
  const contextSection = buildContextSection(opts.context);
  const usageSection = buildUsageHints(opts.context);
  const structure = buildStructureSpec(detail, opts, true);
  const maxTokenHint = detail === "short" ? 1200 : detail === "normal" ? 2000 : detail === "large" ? 4000 : 7000;

  const styleLine = styleInstruction(opts.style);

  return `You are a senior software engineer writing a production-quality GitHub README.md IN VIETNAMESE.
The README must be written entirely in Vietnamese — this is a hard requirement.
Audience: Vietnamese developers on Viblo, GitHub, TopDev.
Detail level: ${detail.toUpperCase()} — target output ~${maxTokenHint} tokens.
${styleLine}

## CRITICAL RULES — violating any of these is a failure
1. Use proper Markdown heading syntax with # symbols. NEVER omit them.
   - H1: # Title  |  H2: ## Section  |  H3: ### Subsection
   WRONG: "✨ Tính năng"       RIGHT: "## ✨ Tính năng"
2. Output ONLY raw Markdown. No explanations before or after. No surrounding code fences.
3. Do NOT add a Table of Contents.
4. Do NOT invent features, CLI flags, subcommands, or environment variables not visible in the provided code.
5. Do NOT invent config file paths — only mention paths that appear in the source code.
6. Architecture/file descriptions: write ONLY what the provided source snippets show. Do NOT infer functionality from file names or general conventions about similar tools.
7. Commander.js \`.name("x")\` sets the program name — it is NOT a subcommand. Only \`.command("x")\` defines subcommands. Do NOT list "name" as a command unless it appears as \`.command("name")\` in the source.
8. Environment variables: list ONLY those from the "CLI / runtime info" section above. Do NOT add rows like "VAR_NAME" or any placeholder — if you don't know a variable name, skip it entirely.
9. Tech Stack: list ONLY direct dependencies from package.json/Cargo.toml/etc. Do NOT list implicit/transitive packages (e.g. esbuild inside tsx, rollup inside vite).${opts.context.hasTests ? "" : "\n10. This project has NO test suite — do NOT mention running tests, writing tests, or test commands anywhere."}

## Project information
- Name: ${opts.projectName}
- Description: ${opts.description}
- Tech stack: ${opts.stack.name} (${techList})
- Package manager: ${opts.stack.packageManager}
${usageSection}${contextSection}
## All project files
${fileList}

## Shields.io badges (copy verbatim into title section)
${badges || "(no badges)"}

## VIETNAMESE WRITING STYLE — critical

Write like a **senior engineer writing internal technical docs for a senior team**: precise, concise, no hand-holding. Confident, authoritative tone — the reader is a developer.
- Short sentences, straight to the point. No filler.
- Use natural Vietnamese technical language. Mix English naturally for framework names, technical terms, and dev workflow words.
- Not too casual ("anh em", "cái này"), not formal/academic ("nhằm mục đích", "được thiết kế để").
- Tone: technical docs written by an engineer for another engineer.

NEVER use these phrases:
"giao diện đẹp và hiện đại" | "hiệu suất cao" | "dễ sử dụng" | "tối ưu hóa" | "giải pháp toàn diện"
"Trong thế giới phát triển phần mềm hiện đại..." | "Đây là một công cụ mạnh mẽ..."
Any intro that sounds like a sales pitch or report introduction.

Keep in English: framework/package names, terminal commands, env vars, technical concepts (state management, hook, middleware, scaffold, parser, endpoint...), dev workflow words (commit, push, PR, deploy, npx).

## GOOD vs BAD examples:

BAD:  "Đây là một công cụ CLI mạnh mẽ được xây dựng để tự động hóa quy trình triển khai."
GOOD: "Parse response của Claude, scaffold file structure, push lên GitHub — trong một lệnh duy nhất."

BAD:  "Hệ thống cung cấp khả năng phát hiện tech stack tự động với độ chính xác cao."
GOOD: "Phát hiện tech stack từ file structure (Node.js, Python, Rust, Go...) và generate \`.gitignore\` tương ứng."

BAD:  "Người dùng có thể dễ dàng cấu hình các thông số theo nhu cầu của mình."
GOOD: "Cấu hình lưu tại \`~/.claudeship/config.json\`, mã hoá AES-256. Chạy \`claude-ship config\` để chỉnh sửa."

BAD:  "Tính năng dry-run cho phép người dùng xem trước kết quả trước khi thực thi."
GOOD: "\`--dry-run\` xuất preview đầy đủ — không ghi disk, không gọi API."

${structure}`;
}

// ─── New programming language prompts ────────────────────────────────────────

function buildNewLanguageEnglishPrompt(opts: ReadmeOptions): string {
  const badges = renderBadges(opts.stack.badges);
  const techList = [...opts.stack.frameworks, ...opts.stack.languages].join(", ");
  const fileList = opts.files.slice(0, 50).join("\n");
  const contextSection = buildContextSection(opts.context);
  const usageSection = buildUsageHints(opts.context);

  return `You are a senior programming language engineer writing a README.md for a new programming language project.
This project IMPLEMENTS a new programming language (not an app using existing languages).
Your goal: help language developers understand the design, features, and how to use/contribute.

## CRITICAL FORMATTING RULES
1. Use proper Markdown heading syntax. NEVER omit # symbols.
2. Output ONLY raw Markdown. No explanations. No surrounding code fences.
3. Do NOT add a Table of Contents.
4. Do NOT invent features not inferable from the provided files.

## Project information
- Name: ${opts.projectName}
- Description: ${opts.description}
- Implementation language(s): ${techList}
- Package manager: ${opts.stack.packageManager}
${usageSection}${contextSection}
## All project files
${fileList}

## Shields.io badges (copy verbatim)
${badges || "(no badges)"}

## Output structure — follow exactly

# <emoji> ${opts.projectName}

<badges verbatim, if any>

> <one-sentence tagline describing what KIND of language this is: paradigm, target use case, killer feature>

<3–4 sentence introduction: what problem the language solves, its design philosophy, how it differs from existing languages>

## ✨ Language Features

- **Bold feature name** — specific language feature inferred from the grammar/AST/code (e.g. pattern matching, algebraic types, async/await, WASM target)
(5–8 bullets, all specific — no generic copy)

## 🔤 Syntax Overview

\`\`\`<lang-name>
<2–3 short, illustrative code examples in the new language — infer from grammar/test files if present>
\`\`\`

## 🏗 Architecture

| Component | Role |
|-----------|------|
| Lexer/Tokenizer | ... |
| Parser | ... |
| AST | ... |
| (add IR, type checker, code gen, VM, etc. if files suggest them) |

## 🛠 Implementation Stack

| Layer | Technology | Version |
|-------|-----------|---------|
(real deps with real version numbers)

## 🚀 Getting Started

### Build from source

\`\`\`bash
git clone https://github.com/${opts.githubUsername ?? "<your-username>"}/${opts.projectName}.git
cd ${opts.projectName}
<build command from package manager>
\`\`\`

### Run a ${opts.projectName} program

\`\`\`bash
<CLI invocation — infer from bin name if available>
\`\`\`

## 🗺 Roadmap

- [ ] (infer next steps from TODO comments, missing pipeline stages, or open grammar rules)

## 🤝 Contributing

<3–4 sentences about contributing: grammar changes, test cases, implementation areas>

## 📄 License

MIT © ${new Date().getFullYear()}`;
}

function buildNewLanguageVietnamesePrompt(opts: ReadmeOptions): string {
  const badges = renderBadges(opts.stack.badges);
  const techList = [...opts.stack.frameworks, ...opts.stack.languages].join(", ");
  const fileList = opts.files.slice(0, 50).join("\n");
  const contextSection = buildContextSection(opts.context);
  const usageSection = buildUsageHints(opts.context);

  return `You are a senior language engineer writing a README.md IN VIETNAMESE for a new programming language project on GitHub.
This project IMPLEMENTS a new programming language — not an app built with existing languages.
The README must be written entirely in Vietnamese — this is a hard requirement.

## CRITICAL RULES — violating any of these is a failure
1. Use proper Markdown heading syntax with # symbols. NEVER omit them.
2. Output ONLY raw Markdown. No explanations. No surrounding code fences.
3. Do NOT add a Table of Contents.
4. Do NOT invent features not present in the actual files/code.

## Project information
- Name: ${opts.projectName}
- Description: ${opts.description}
- Implementation language(s): ${techList}
- Package manager: ${opts.stack.packageManager}
${usageSection}${contextSection}
## All project files
${fileList}

## Badges (copy verbatim)
${badges || "(no badges)"}

## VIETNAMESE WRITING STYLE
- Keep English for technical terms: lexer, parser, AST, IR, bytecode, WASM, type system, pattern matching, etc.
- Write natural, terse Vietnamese — NOT machine translation.
- NEVER use: "hiệu suất cao", "dễ sử dụng", "tối ưu hóa" (vague generics).

## Output structure — write in Vietnamese following this template exactly

# <emoji> ${opts.projectName}

<badges verbatim>

> <one sentence in Vietnamese: what kind of language, paradigm, target use case>

<3–4 sentences in Vietnamese: problem solved, design philosophy, how it differs from existing languages>

## ✨ Tính năng ngôn ngữ

- **Feature name in Vietnamese** — specific description inferred from grammar/AST/code
(5–8 bullets)

## 🔤 Cú pháp

\`\`\`<lang-name>
<2–3 short code examples in the new language — infer from grammar/test files>
\`\`\`

## 🏗 Kiến trúc

| Thành phần | Vai trò |
|-----------|---------|
| Lexer | ... |
| Parser | ... |
| AST | ... |
(add IR, type checker, codegen, VM if files suggest them)

## 🛠 Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|

## 🚀 Build & chạy thử

\`\`\`bash
git clone https://github.com/${opts.githubUsername ?? "<your-username>"}/${opts.projectName}.git
cd ${opts.projectName}
<build command>
<run a ${opts.projectName} program>
\`\`\`

## 🗺 Roadmap

- [ ] (infer from TODOs, missing pipeline stages, incomplete grammar rules)

## 🤝 Đóng góp

<3–4 sentences in Vietnamese about contributing: grammar changes, test cases, implementation areas>

## 📄 License

MIT © ${new Date().getFullYear()}`;
}

// ─── License helpers ─────────────────────────────────────────────────────────

const LICENSE_LABELS: Record<LicenseType, string> = {
  "MIT": "MIT",
  "Apache-2.0": "Apache 2.0",
  "GPL-3.0": "GNU GPL v3",
  "AGPL-3.0": "GNU AGPL v3",
  "BSD-2-Clause": "BSD 2-Clause",
  "BSD-3-Clause": "BSD 3-Clause",
  "ISC": "ISC",
  "Unlicense": "The Unlicense (public domain)",
  "proprietary": "Proprietary — All Rights Reserved",
};

export function licenseLabel(type: LicenseType): string {
  return LICENSE_LABELS[type] ?? "MIT";
}

function licenseSection(type: LicenseType, author: string, vi: boolean): string {
  const year = new Date().getFullYear();
  const label = licenseLabel(type);
  const copy = type === "proprietary"
    ? `Copyright © ${year} ${author}. All Rights Reserved.`
    : type === "Unlicense"
      ? "This project is released into the public domain."
      : `[${label}](LICENSE) © ${year} ${author}`;

  return vi
    ? `## 📄 License\n\n${copy}`
    : `## 📄 License\n\n${copy}`;
}

// ─── Section resolver ─────────────────────────────────────────────────────────

interface ResolvedSections {
  screenshot: boolean;
  contributing: boolean;
  license: boolean;
  changelog: boolean;
  faq: boolean;
}

function resolveSections(sections?: ReadmeSections): ResolvedSections {
  return {
    screenshot:   sections?.screenshot   ?? true,
    contributing: sections?.contributing ?? true,
    license:      sections?.license      ?? true,
    changelog:    sections?.changelog    ?? false,
    faq:          sections?.faq          ?? false,
  };
}

// ─── Detail-level structure specs ────────────────────────────────────────────

function buildStructureSpec(
  detail: ReadmeDetail,
  opts: ReadmeOptions,
  vi: boolean
): string {
  const { projectName, context } = opts;
  const installBlock = buildInstallSection(context, projectName, vi, opts.githubUsername);
  const sec = resolveSections(opts.sections);
  const license = opts.license ?? "MIT";
  const author = opts.author || opts.context.binName || "the author";
  const licSec = sec.license ? "\n" + licenseSection(license, author, vi) : "";
  const screenshotSec = sec.screenshot ? (vi
    ? `\n## 📸 Screenshot\n\n${SCREENSHOT_PLACEHOLDER}`
    : `\n## 📸 Screenshot\n\n${SCREENSHOT_PLACEHOLDER}`) : "";
  const changelogSec = sec.changelog ? (vi
    ? "\n## 📝 Changelog\n\n<Danh sách thay đổi theo version — đặc biệt là breaking changes>"
    : "\n## 📝 Changelog\n\n<Version history — especially breaking changes>") : "";
  const faqSec = sec.faq ? (vi
    ? "\n## ❓ FAQ\n\n<3–5 câu hỏi thường gặp, suy từ edge cases trong code>"
    : "\n## ❓ FAQ\n\n<3–5 frequently asked questions, inferred from edge cases in the code>") : "";

  const contributingSec = sec.contributing ? (vi
    ? (detail === "carefully"
        ? "\n## 🤝 Đóng góp\n\n<5–6 câu: setup môi trường dev, coding conventions, test, PR process>"
        : "\n## 🤝 Đóng góp\n\n<3–4 câu: fork → branch → mở PR, mention mở issue trước cho thay đổi lớn>")
    : (detail === "carefully"
        ? "\n## 🤝 Contributing\n\n<5–6 sentences: dev setup, conventions, tests, PR process>"
        : "\n## 🤝 Contributing\n\n<3–4 sentences: fork → branch → PR, open an issue for big changes>")
  ) : "";

  if (detail === "short") {
    return vi
      ? `## Cấu trúc output

# <emoji> ${projectName}

<badges nguyên xi, nếu có>

> <tagline một câu, cụ thể>

<1–2 câu giới thiệu — thẳng vào vấn đề, không mở đầu sáo rỗng>

## ✨ Tính năng

- **Keyword** — mô tả cụ thể (3–4 bullets thôi)

## 🚀 Bắt đầu nhanh

${installBlock}
${licSec}`
      : `## Output structure

# <emoji> ${projectName}

<badges verbatim, if any>

> <one-sentence tagline>

<1–2 sentence intro — straight to the point>

## ✨ Features

- **Keyword** — specific description (3–4 bullets only)

## 🚀 Getting Started

${installBlock}
${licSec}`;
  }

  if (detail === "normal") {
    return vi
      ? `## Cấu trúc output

# <emoji> ${projectName}

<badges nguyên xi, nếu có>

> <tagline một câu>

<2–3 câu giới thiệu — focus vào vấn đề được giải quyết>

## ✨ Tính năng

- **Keyword** — mô tả cụ thể (5–7 bullets)

## 🛠 Tech Stack

| Layer | Technology | Mô tả |
|-------|-----------|-------|

## 🚀 Bắt đầu nhanh

### Yêu cầu

- <runtime + version>

${installBlock}

## 📖 Sử dụng

<1–2 ví dụ thực tế>${screenshotSec}${changelogSec}${faqSec}${contributingSec}${licSec}`
      : `## Output structure

# <emoji> ${projectName}

<badges verbatim, if any>

> <one-sentence tagline>

<2–3 sentence intro>

## ✨ Features

- **Keyword** — specific description (5–7 bullets)

## 🛠 Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|

## 🚀 Getting Started

### Prerequisites

- <runtime + version>

${installBlock}

## 📖 Usage

<1–2 concrete examples>${screenshotSec}${changelogSec}${faqSec}${contributingSec}${licSec}`;
  }

  if (detail === "large") {
    return vi
      ? `## Cấu trúc output

# <emoji> ${projectName}

<badges nguyên xi>

> <tagline một câu>

<3–4 câu giới thiệu>

## ✨ Tính năng

- **Keyword** — mô tả cụ thể (7–10 bullets)

## 🏗 Kiến trúc & Các file chính

| File | Chức năng |
|------|-----------|
| (list các file quan trọng nhất với mô tả 1 câu) |

## 🛠 Tech Stack

| Layer | Technology | Version | Mô tả |
|-------|-----------|---------|-------|

## 🚀 Bắt đầu nhanh

### Yêu cầu

- <runtime + version>
- <env vars bắt buộc nếu có>

${installBlock}

## 📖 Sử dụng chi tiết

<3–5 ví dụ thực tế>

## ⚙️ Cấu hình

<Env vars, config options quan trọng — suy từ code>${screenshotSec}${changelogSec}${faqSec}${contributingSec}${licSec}`
      : `## Output structure

# <emoji> ${projectName}

<badges verbatim>

> <one-sentence tagline>

<3–4 sentence intro>

## ✨ Features

- **Keyword** — specific description (7–10 bullets)

## 🏗 Architecture & Key Files

| File | Role |
|------|------|
| (list important files with one-sentence description each) |

## 🛠 Tech Stack

| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|

## 🚀 Getting Started

### Prerequisites

- <runtime + version>
- <required env vars>

${installBlock}

## 📖 Usage

<3–5 concrete examples>

## ⚙️ Configuration

<Important env vars, config options — inferred from code>${screenshotSec}${changelogSec}${faqSec}${contributingSec}${licSec}`;
  }

  // carefully
  return vi
    ? `## Cấu trúc output

# <emoji> ${projectName}

<badges nguyên xi>

> <tagline một câu>

<4–5 câu giới thiệu đầy đủ>

## ✨ Tính năng

- **Keyword** — mô tả chi tiết (10+ bullets)

## 🏗 Kiến trúc

<2–3 câu tổng quan>

| Module/File | Chức năng chi tiết |
|-------------|-------------------|
| (MỌI file quan trọng) |

## 🔄 Luồng hoạt động

<Step-by-step luồng chính, suy từ code>

## 🛠 Tech Stack

| Layer | Technology | Version | Tại sao dùng |
|-------|-----------|---------|-------------|

## 🚀 Bắt đầu nhanh

### Yêu cầu

- <runtime + version>
- <MỌI env vars cần thiết>

${installBlock}

## 📖 Sử dụng đầy đủ

<5–8 ví dụ thực tế>

## ⚙️ Cấu hình chi tiết

<Bảng đầy đủ env vars, flags>

## 🐛 Troubleshooting

<3–5 lỗi phổ biến và cách fix>${screenshotSec}${changelogSec}${faqSec}${contributingSec}${licSec}`
    : `## Output structure

# <emoji> ${projectName}

<badges verbatim>

> <one-sentence tagline>

<4–5 sentence intro: problem, solution, key differentiators>

## ✨ Features

- **Keyword** — detailed specific description (10+ bullets, cover every feature inferable from code)

## 🏗 Architecture

<2–3 sentence high-level architecture overview>

| Module/File | Detailed Role |
|-------------|--------------|
| (EVERY important file — describe input/output/role clearly) |

## 🔄 How It Works

<Step-by-step flow of the main execution path, inferred from code>

## 🛠 Tech Stack

| Layer | Technology | Version | Why |
|-------|-----------|---------|-----|

## 🚀 Getting Started

### Prerequisites

- <runtime + version>
- <EVERY required env var with explanation>

${installBlock}

## 📖 Full Usage Reference

<5–8 concrete examples covering every important command/flag/use case>

## ⚙️ Configuration Reference

<Full table of all env vars, config options, flags — inferred from code>

## 🐛 Troubleshooting

<3–5 common errors and fixes, inferred from error handling in code>${screenshotSec}${changelogSec}${faqSec}${contributingSec}${licSec}`;
}

// ─── Install section builder ──────────────────────────────────────────────────

function buildInstallSection(ctx: ReadmeContext, projectName: string, vietnamese: boolean, githubUsername?: string): string {
  const isCli = Boolean(ctx.binName);
  const repoUrl = githubUsername
    ? `https://github.com/${githubUsername}/${projectName}.git`
    : `https://github.com/<your-username>/${projectName}.git`;

  if (isCli) {
    const bin = ctx.binName;
    if (vietnamese) {
      return `### Cài đặt

\`\`\`bash
# Dùng thẳng với npx — không cần cài global
npx ${bin}

# Hoặc cài global một lần
npm install -g ${projectName}
${bin} --help
\`\`\`

### Dành cho contributor

\`\`\`bash
git clone ${repoUrl}
cd ${projectName}
npm install
npm run build
node dist/index.js --help
\`\`\``;
    } else {
      return `### Installation

\`\`\`bash
# No install needed — run directly with npx
npx ${bin}

# Or install globally once
npm install -g ${projectName}
${bin} --help
\`\`\`

### For contributors

\`\`\`bash
git clone ${repoUrl}
cd ${projectName}
npm install
npm run build
node dist/index.js --help
\`\`\``;
    }
  }

  // Non-CLI project — standard clone flow
  const installCmd = installCommandFromCtx(ctx);
  if (vietnamese) {
    return `### Cài đặt

\`\`\`bash
git clone ${repoUrl}
cd ${projectName}
${installCmd}
<các bước setup thêm nếu cần — .env, migrate, v.v.>
<lệnh chạy>
\`\`\``;
  }
  return `### Installation

\`\`\`bash
git clone ${repoUrl}
cd ${projectName}
${installCmd}
<any extra setup steps — .env, migrate, etc.>
<run command>
\`\`\``;
}

function installCommandFromCtx(ctx: ReadmeContext): string {
  switch (ctx.packageManager) {
    case "pip": return "pip install -r requirements.txt";
    case "cargo": return "cargo build --release";
    case "go": return "go mod download && go build ./...";
    case "yarn": return "yarn install";
    case "pnpm": return "pnpm install";
    default: return "npm install";
  }
}

// ─── Shared context builders ──────────────────────────────────────────────────

/**
 * Produces a "Usage hints" block for the prompt so the model writes the
 * correct CLI invocation instead of hallucinating one.
 */
function buildUsageHints(ctx: ReadmeContext): string {
  const lines: string[] = [];

  if (ctx.binName) {
    lines.push(`- CLI binary name: \`${ctx.binName}\` (run as \`npx ${ctx.binName}\` or \`${ctx.binName}\` if installed globally)`);
  }
  if (ctx.cliCommands.length > 0) {
    lines.push(`- CLI subcommands (ONLY document these — do not invent others): ${ctx.cliCommands.join(", ")}`);
  }
  if (ctx.envVars.length > 0) {
    lines.push(`- Environment variables actually used (ONLY these — do not invent others): ${ctx.envVars.join(", ")}`);
  }
  if (ctx.cliScripts) {
    lines.push(`- npm scripts: ${ctx.cliScripts}`);
  }
  if (ctx.depsWithVersions) {
    lines.push(`- Key dependencies (use these real versions in the Tech Stack table): ${ctx.depsWithVersions}`);
  }

  if (lines.length === 0) return "";
  return `## CLI / runtime info (use these EXACTLY — do not invent)\n${lines.join("\n")}\n`;
}

function buildContextSection(ctx: ReadmeContext): string {
  const parts: string[] = [];

  if (ctx.configFileName && ctx.configSnippet) {
    parts.push(`## Config file: ${ctx.configFileName}
\`\`\`
${ctx.configSnippet}
\`\`\``);
  }

  if (ctx.entryFileName && ctx.entrySnippet) {
    parts.push(`## Entry point: ${ctx.entryFileName}
\`\`\`
${ctx.entrySnippet}
\`\`\``);
  }

  if (parts.length > 0) {
    parts.push(`## ⚠ REMINDER while reading source files below
- \`.name("x")\` in Commander.js sets the PROGRAM NAME — it is NOT a subcommand. Do not list it as a command.
- \`.version()\`, \`.description()\` are also NOT subcommands.
- Only \`.command("x")\` defines a subcommand.
- Do NOT list transitive/implicit dependencies (e.g. esbuild inside tsx) — only list what is in package.json dependencies/devDependencies.
- Environment variables: use ONLY the list from "CLI / runtime info" above. Do NOT invent VAR_NAME or any placeholder.`);
  }

  for (const { filename, snippet } of ctx.additionalSnippets) {
    parts.push(`## Source file: ${filename}
\`\`\`
${snippet}
\`\`\``);
  }

  return parts.length > 0 ? parts.join("\n\n") + "\n" : "";
}

// ─── Star history helpers ─────────────────────────────────────────────────────

function injectBeforeLicense(readme: string, block: string): string {
  // Prefer inserting before Contributing section, fall back to before License
  const anchor =
    /^## [^\n]*(Contributing|Đóng góp)/m.exec(readme) ??
    /^## [^\n]*[Ll]icense/m.exec(readme);
  if (anchor) {
    const idx = anchor.index;
    return readme.slice(0, idx).trimEnd() + "\n\n" + block + "\n\n" + readme.slice(idx);
  }
  return readme.trimEnd() + "\n\n" + block;
}

// ─── Star history block ───────────────────────────────────────────────────────

function starHistoryBlock(username: string, repoName: string): string {
  const repo = `${username}/${repoName}`;
  return `## ⭐ Star History

<p align="center">
  <a href="https://star-history.com/#${repo}&Date">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=${repo}&type=Date&theme=dark" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=${repo}&type=Date" />
      <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=${repo}&type=Date" width="600" />
    </picture>
  </a>
</p>`;
}

// ─── Generator ────────────────────────────────────────────────────────────────

export async function generateReadme(opts: ReadmeOptions): Promise<string> {
  const isNewLang = opts.stack.isNewLanguage;

  function buildPrompt(suffix = ""): string {
    const base = isNewLang
      ? opts.vietnamese
        ? buildNewLanguageVietnamesePrompt(opts)
        : buildNewLanguageEnglishPrompt(opts)
      : opts.vietnamese
        ? buildVietnamesePrompt(opts)
        : buildEnglishPrompt(opts);
    return base + suffix;
  }

  const detail = opts.detail ?? "normal";
  const defaultTokens =
    detail === "short" ? 2000 :
    detail === "normal" ? 4000 :
    detail === "large" ? 8000 : 16000;
  // 0 means "no artificial limit" — provider will use its own maximum
  const maxTokens = opts.maxTokens === 0 ? 32000 : (opts.maxTokens ?? defaultTokens);

  async function generate(prompt: string): Promise<string> {
    const text = await generateText({ provider: opts.provider, apiKey: opts.apiKey, prompt, maxTokens });
    let result = text.trim();
    // Strip "name" from any subcommand enumeration — .name() sets program name, not a command
    result = result.replace(/,\s*(?:and\s+)?`name`/g, "").replace(/`name`(?:,\s*)/g, "");
    return result;
  }

  let result = await generate(buildPrompt());
  const { text, score } = sanitizeOutput(result, opts.context);
  result = text;

  // Quality gate: regen once if score is too low
  if (score < 60) {
    const retry = await generate(buildPrompt(stricterPromptSuffix()));
    const retryClean = sanitizeOutput(retry, opts.context);
    if (retryClean.score >= score) {
      result = retryClean.text;
    }
  }

  if (opts.sections?.starHistory && opts.githubUsername) {
    result = injectBeforeLicense(result, starHistoryBlock(opts.githubUsername, opts.projectName));
  }
  return result;
}

export function providerDisplayName(provider: Provider): string {
  return providerLabel(provider);
}

// ─── Fallback template (no API key) ──────────────────────────────────────────

export function generateReadmeFallback(
  opts: Omit<ReadmeOptions, "provider" | "apiKey">
): string {
  const badges = renderBadges(opts.stack.badges);
  const techList = [...opts.stack.frameworks, ...opts.stack.languages];

  // Auto-derive features from what we actually know
  const features = deriveFeatures(opts.stack, opts.files, opts.context);

  const install = installCommand(opts.stack.packageManager);
  const dev = devCommand(opts.stack.packageManager);

  const hasEnvExample = opts.files.includes(".env.example");
  const hasPrisma = opts.files.some((f) => f.endsWith(".prisma"));
  const hasDocker = opts.files.includes("Dockerfile") || opts.files.includes("docker-compose.yml");

  const extraSteps: string[] = [];
  if (hasEnvExample) extraSteps.push("cp .env.example .env  # fill in your values");
  if (hasPrisma) extraSteps.push("npx prisma migrate dev  # set up database schema");

  let result = `# ${opts.projectName}

${badges ? badges + "\n\n" : ""}> ${opts.description || `A ${opts.stack.name} project.`}

## ✨ Features

${features.map((f) => `- ${f}`).join("\n")}

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
${techList.map((t) => `| — | ${t} |`).join("\n")}${hasDocker ? "\n| Infra | Docker |" : ""}

## 🚀 Getting Started

### Prerequisites

- ${runtimeLabel(opts.stack.packageManager)} installed
- Copy \`.env.example\` to \`.env\` and fill in required values${hasPrisma ? "\n- PostgreSQL (or configured DB) running" : ""}

### Installation

\`\`\`bash
git clone https://github.com/${opts.githubUsername ?? "<your-username>"}/${opts.projectName}.git
cd ${opts.projectName}
${install}${extraSteps.length > 0 ? "\n" + extraSteps.join("\n") : ""}
${dev}
\`\`\`

## 📖 Usage

\`\`\`bash
# Add a usage example here
\`\`\`

## 📸 Screenshot

${SCREENSHOT_PLACEHOLDER}

## 🤝 Contributing

Contributions are welcome. Fork the repo, create a feature branch, and open a Pull Request.
Please open an issue first to discuss significant changes.

## 📄 License

[MIT](LICENSE) © ${new Date().getFullYear()}
`;

  if (opts.sections?.starHistory && opts.githubUsername) {
    result = injectBeforeLicense(result, starHistoryBlock(opts.githubUsername, opts.projectName));
  }
  return result;
}

// ─── Feature auto-derivation ──────────────────────────────────────────────────

function deriveFeatures(
  stack: TechStack,
  files: string[],
  ctx: ReadmeContext
): string[] {
  const features: string[] = [];

  // Stack-based
  if (stack.frameworks.includes("Next.js")) {
    const hasAppRouter = files.some((f) => f.startsWith("app/") || f.startsWith("src/app/"));
    features.push(
      hasAppRouter
        ? "**Next.js App Router** — file-based routing with React Server Components"
        : "**Next.js** — server-side rendering and static generation"
    );
  }
  if (stack.frameworks.includes("FastAPI")) {
    features.push("**FastAPI** — auto-generated OpenAPI docs at `/docs`");
  }
  if (stack.frameworks.includes("React") && !stack.frameworks.includes("Next.js")) {
    features.push("**React** — component-based UI with hooks");
  }
  if (stack.frameworks.includes("SvelteKit")) {
    features.push("**SvelteKit** — file-based routing with SSR and SSG support");
  }

  // File-based detection
  if (files.some((f) => f.includes("prisma"))) {
    features.push("**Prisma ORM** — type-safe database access with auto-generated client");
  }
  if (files.some((f) => f.includes("tailwind"))) {
    features.push("**Tailwind CSS** — utility-first styling with responsive design");
  }
  if (files.some((f) => f.includes("auth") || f.includes("Auth"))) {
    features.push("**Authentication** — user auth flow included");
  }
  if (files.some((f) => f.endsWith(".test.ts") || f.endsWith(".spec.ts") || f.endsWith(".test.tsx"))) {
    features.push("**Tests included** — unit and integration test suite");
  }
  if (files.includes("Dockerfile") || files.includes("docker-compose.yml")) {
    features.push("**Docker ready** — containerised for easy deployment");
  }
  if (files.some((f) => f.includes(".github/workflows"))) {
    features.push("**CI/CD** — GitHub Actions workflow included");
  }

  // Config-based detection
  if (ctx.configSnippet.includes("zod")) {
    features.push("**Zod validation** — runtime type-safe schema validation");
  }
  if (ctx.configSnippet.includes("drizzle")) {
    features.push("**Drizzle ORM** — lightweight type-safe SQL ORM");
  }
  if (ctx.configSnippet.includes("stripe")) {
    features.push("**Stripe integration** — payment processing built in");
  }
  if (ctx.configSnippet.includes("openai") || ctx.configSnippet.includes("anthropic")) {
    features.push("**AI-powered** — LLM integration for intelligent features");
  }
  if (ctx.configSnippet.includes("resend") || ctx.configSnippet.includes("nodemailer")) {
    features.push("**Email support** — transactional email integration");
  }

  // Ensure at least 4 features
  if (features.length < 4) {
    const generic = [
      `**${stack.name}** — full project scaffold, ready to extend`,
      "**TypeScript** — end-to-end type safety",
      "**Environment config** — `.env.example` template included",
      "**Clean project structure** — organised for scalability",
    ];
    for (const g of generic) {
      if (features.length >= 5) break;
      if (!features.some((f) => f.startsWith(g.split("**")[1]?.split("**")[0] ?? ""))) {
        features.push(g);
      }
    }
  }

  return features.slice(0, 7);
}

// ─── Install / dev command helpers ───────────────────────────────────────────

function installCommand(pm: TechStack["packageManager"]): string {
  switch (pm) {
    case "pip": return "pip install -r requirements.txt";
    case "cargo": return "cargo build --release";
    case "go": return "go mod download";
    case "yarn": return "yarn install";
    case "pnpm": return "pnpm install";
    default: return "npm install";
  }
}

function devCommand(pm: TechStack["packageManager"]): string {
  switch (pm) {
    case "pip": return "python main.py";
    case "cargo": return "cargo run";
    case "go": return "go run .";
    case "yarn": return "yarn dev";
    case "pnpm": return "pnpm dev";
    default: return "npm run dev";
  }
}

function runtimeLabel(pm: TechStack["packageManager"]): string {
  switch (pm) {
    case "pip": return "Python 3.10+";
    case "cargo": return "Rust (stable toolchain)";
    case "go": return "Go 1.21+";
    default: return "Node.js 18+";
  }
}

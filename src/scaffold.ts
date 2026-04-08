import fs from "fs";
import path from "path";
import { ParsedFile, LicenseType } from "./types.js";

// ─── Write helpers ────────────────────────────────────────────────────────────

export function writeFiles(outputDir: string, files: ParsedFile[]): void {
  const resolvedBase = path.resolve(outputDir);
  fs.mkdirSync(resolvedBase, { recursive: true });
  for (const file of files) {
    const fullPath = path.resolve(resolvedBase, normalizeFsPath(file.path));
    if (!fullPath.startsWith(resolvedBase + path.sep)) {
      throw new Error(`Unsafe path rejected: "${file.path}"`);
    }
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, file.content, "utf8");
  }
}

export function writeFile(outputDir: string, filePath: string, content: string): void {
  const resolvedBase = path.resolve(outputDir);
  const fullPath = path.resolve(resolvedBase, normalizeFsPath(filePath));
  if (!fullPath.startsWith(resolvedBase + path.sep) && fullPath !== resolvedBase) {
    throw new Error(`Unsafe path rejected: "${filePath}"`);
  }
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
}

/** Normalise a logical file path for the current OS (handle \ on Windows). */
function normalizeFsPath(p: string): string {
  return p.replace(/\//g, path.sep);
}

// ─── Read helpers ─────────────────────────────────────────────────────────────

export function readInputFile(filePath: string): string {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  return fs.readFileSync(resolved, "utf8");
}

const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "build", "out", ".next", ".nuxt",
  "__pycache__", ".pytest_cache", "target", ".cargo",
  ".omc", ".claude", ".vscode", ".idea",
  "coverage", ".nyc_output", ".turbo",
]);

export function getAllFilePaths(dir: string): string[] {
  const results: string[] = [];
  const walk = (current: string) => {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else results.push(path.relative(dir, full).replace(/\\/g, "/"));
    }
  };
  walk(dir);
  return results;
}

// ─── Output directory ─────────────────────────────────────────────────────────

export function resolveOutputDir(projectName: string, base = process.cwd()): string {
  // On Windows, process.cwd() may contain backslashes or Unicode username chars.
  // path.resolve handles both correctly — just make sure we use path.join.
  return path.resolve(base, projectName);
}

// ─── Conflict detection ───────────────────────────────────────────────────────

export interface ConflictInfo {
  existing: string[];   // relative paths that already exist on disk
  missing: string[];    // relative paths that will be created fresh
}

export function checkConflicts(outputDir: string, files: ParsedFile[]): ConflictInfo {
  const existing: string[] = [];
  const missing: string[] = [];

  for (const file of files) {
    const full = path.join(outputDir, normalizeFsPath(file.path));
    if (fs.existsSync(full)) existing.push(file.path);
    else missing.push(file.path);
  }

  return { existing, missing };
}

// ─── README context extraction ────────────────────────────────────────────────

/** Priority-ordered lists of config and entry-point file names. */
const CONFIG_PRIORITY = [
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "requirements.txt",
  "pom.xml",
  "build.gradle",
  "composer.json",
];

const ENTRY_PRIORITY = [
  // Next.js App Router
  "app/page.tsx",
  "app/page.jsx",
  "src/app/page.tsx",
  "src/app/page.jsx",
  // Next.js Layout / root
  "app/layout.tsx",
  "src/app/layout.tsx",
  // React (Vite / CRA)
  "src/main.tsx",
  "src/main.jsx",
  "src/App.tsx",
  "src/App.jsx",
  "src/index.tsx",
  "src/index.jsx",
  // Svelte
  "src/routes/+page.svelte",
  "src/App.svelte",
  // Python
  "main.py",
  "app/main.py",
  "src/main.py",
  "app.py",
  "run.py",
  // Node / generic TS
  "src/index.ts",
  "src/server.ts",
  "index.ts",
  "index.js",
  // Go
  "main.go",
  "cmd/main.go",
  // Rust
  "src/main.rs",
  // Java / Kotlin
  "src/main/java/Main.java",
  "src/main/kotlin/Main.kt",
];

export interface WorkspacePackage {
  name: string;
  path: string;
  description?: string;
  version?: string;
}

export interface ReadmeContext {
  configFileName: string;
  configSnippet: string;
  entryFileName: string;
  entrySnippet: string;
  /** CLI binary name(s) from package.json `bin`, e.g. "claude-ship" */
  binName: string;
  /** Key npm scripts, e.g. "dev: tsx src/index.ts | build: tsc" */
  cliScripts: string;
  /** Top dependencies with real version strings, e.g. "commander@^12.1.0, chalk@^5.3.0" */
  depsWithVersions: string;
  /** Up to 4 additional representative source files beyond the entry point */
  additionalSnippets: Array<{ filename: string; snippet: string }>;
  /** CLI subcommands detected from source files, e.g. ["ship", "push", "readme", "config"] */
  cliCommands: string[];
  /** Environment variables actually referenced in source code, e.g. ["ANTHROPIC_API_KEY", "GITHUB_TOKEN"] */
  envVars: string[];
  /** Detected package manager, e.g. "npm", "pip", "cargo", "go" */
  packageManager: string;
  /** True if the project has test files or a test script */
  hasTests: boolean;
  /** Workspace packages detected in monorepo setups */
  workspacePackages: WorkspacePackage[];
}

interface PackageJson {
  name?: string;
  description?: string;
  version?: string;
  bin?: Record<string, string> | string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Extract the most useful context snippets from parsed files for the README
 * generator to produce specific, non-generic features.
 */
export function extractReadmeContext(files: ParsedFile[]): ReadmeContext {
  const byPath = new Map(files.map((f) => [f.path, f]));

  // Config file
  let configFileName = "";
  let configSnippet = "";
  let binName = "";
  let cliScripts = "";
  let depsWithVersions = "";

  for (const name of CONFIG_PRIORITY) {
    const f = byPath.get(name);
    if (f) {
      configFileName = name;
      configSnippet = headLines(f.content, 35);

      // Parse package.json for structured metadata
      if (name === "package.json" && f.content) {
        try {
          const pkg = JSON.parse(f.content) as PackageJson;

          // bin field → CLI name(s)
          if (pkg.bin) {
            if (typeof pkg.bin === "string") {
              binName = pkg.name ?? "";
            } else {
              binName = Object.keys(pkg.bin).join(", ");
            }
          }

          // scripts → pick the most useful ones
          if (pkg.scripts) {
            const SHOW_SCRIPTS = ["dev", "start", "build", "test", "lint", "preview"];
            const shown = SHOW_SCRIPTS
              .filter((k) => pkg.scripts![k])
              .map((k) => `${k}: ${pkg.scripts![k]}`);
            cliScripts = shown.join(" | ");
          }

          // dependencies with real versions (runtime + dev, to catch TypeScript/ESLint etc.)
          const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
          const top = Object.entries(allDeps)
            .slice(0, 16)
            .map(([pkg, ver]) => `${pkg}@${ver}`);
          depsWithVersions = top.join(", ");
        } catch {
          // malformed package.json — use raw snippet only
        }
      }

      break;
    }
  }

  // Entry point
  let entryFileName = "";
  let entrySnippet = "";
  for (const name of ENTRY_PRIORITY) {
    const f = byPath.get(name);
    if (f) {
      entryFileName = name;
      entrySnippet = keySnippet(f.content);
      break;
    }
  }

  // Fallback: pick the largest non-config file as entry
  if (!entryFileName) {
    const candidates = files
      .filter((f) => !CONFIG_PRIORITY.includes(f.path))
      .sort((a, b) => b.content.length - a.content.length);
    const top = candidates[0];
    if (top) {
      entryFileName = top.path;
      entrySnippet = keySnippet(top.content);
    }
  }

  // Additional key source files — as many as possible, beyond config + entry already picked
  const alreadyUsed = new Set([configFileName, entryFileName].filter(Boolean));
  const additionalSnippets = pickKeyFiles(files, alreadyUsed, 12);

  // Detect CLI subcommands from Commander-style .command("name") calls in source files
  const cliCommands = detectCliCommands(files);

  // Detect env vars actually referenced in source code
  const envVars = detectEnvVars(files);

  // Detect package manager from config file
  const packageManager = resolvePackageManager(configFileName, depsWithVersions);

  // Detect if project has tests (test files or test script)
  const hasTests =
    cliScripts.includes("test:") ||
    files.some((f) => /\.(test|spec)\.(ts|js|tsx|jsx|py|rs|go)$/.test(f.path) || f.path.includes("__tests__"));

  const workspacePackages = detectWorkspaces(files);

  return { configFileName, configSnippet, entryFileName, entrySnippet, binName, cliScripts, depsWithVersions, additionalSnippets, cliCommands, envVars, packageManager, hasTests, workspacePackages };
}

// ─── Monorepo / workspace detector ───────────────────────────────────────────

function detectWorkspaces(files: ParsedFile[]): WorkspacePackage[] {
  const rootPkg = files.find((f) => f.path === "package.json");
  if (!rootPkg?.content) return [];

  try {
    const pkg = JSON.parse(rootPkg.content) as { workspaces?: string[] | { packages?: string[] } };
    const patterns = Array.isArray(pkg.workspaces)
      ? pkg.workspaces
      : pkg.workspaces?.packages;
    if (!patterns || patterns.length === 0) return [];
  } catch {
    return [];
  }

  // Find all nested package.json files (depth 2, e.g., packages/foo/package.json)
  const nested = files.filter(
    (f) => f.path !== "package.json" && f.path.endsWith("/package.json") && f.path.split("/").length <= 3
  );

  const packages: WorkspacePackage[] = [];
  for (const f of nested) {
    try {
      const p = JSON.parse(f.content) as { name?: string; description?: string; version?: string };
      const dir = f.path.replace(/\/package\.json$/, "");
      packages.push({
        name: p.name ?? dir,
        path: dir,
        description: p.description,
        version: p.version,
      });
    } catch {
      // skip malformed
    }
  }

  // Also check for pnpm-workspace.yaml
  if (packages.length === 0) {
    const pnpmWs = files.find((f) => f.path === "pnpm-workspace.yaml");
    if (pnpmWs) {
      // If pnpm-workspace.yaml exists but we couldn't find nested packages, just return empty
      // The workspace detection still flags it as a monorepo via the yaml presence
    }
  }

  return packages;
}

// ─── CLI command detector ─────────────────────────────────────────────────────

function detectCliCommands(files: ParsedFile[]): string[] {
  const commands = new Set<string>();
  // Commander.js: .command("name") or .command("name", { isDefault: true })
  const commanderRe = /\.command\(\s*["'`]([a-z][\w-]*)["'`]/g;
  // Click (Python): @cli.command() or @app.command("name")
  const clickRe = /@(?:\w+\.)?command\(\s*(?:["'`]([a-z][\w-]*)["'`])?\s*\)/g;
  // Cobra (Go): &cobra.Command{Use: "name"}
  const cobraRe = /Use:\s*["'`]([a-z][\w-]*)["'`]/g;
  // Clap (Rust): #[command(name = "name")] or Command::new("name")
  const clapRe = /Command::new\(\s*["'`]([a-z][\w-]*)["'`]/g;

  for (const f of files) {
    if (!f.content) continue;
    const ext = f.path.split(".").pop()?.toLowerCase() ?? "";

    if (["ts", "js", "mjs"].includes(ext)) {
      for (const m of f.content.matchAll(commanderRe)) {
        if (m[1] && m[1].length > 1) commands.add(m[1]);
      }
    }
    if (ext === "py") {
      for (const m of f.content.matchAll(clickRe)) {
        if (m[1]) commands.add(m[1]);
      }
    }
    if (ext === "go") {
      for (const m of f.content.matchAll(cobraRe)) {
        if (m[1]) commands.add(m[1]);
      }
    }
    if (ext === "rs") {
      for (const m of f.content.matchAll(clapRe)) {
        if (m[1]) commands.add(m[1]);
      }
    }
  }

  return Array.from(commands);
}

// ─── Env var detector ─────────────────────────────────────────────────────────

function detectEnvVars(files: ParsedFile[]): string[] {
  const vars = new Set<string>();
  // JS/TS: process.env["KEY"] or process.env.KEY
  const nodeRe = /process\.env\.([A-Z][A-Z0-9_]+)/g;
  // Python: os.environ["VAR"] or os.getenv("VAR")
  const pythonRe = /os\.(?:environ\[["']|getenv\(["'])([A-Z][A-Z0-9_]+)/g;
  // Rust: env::var("VAR")
  const rustRe = /env::var\(\s*["']([A-Z][A-Z0-9_]+)["']/g;
  // Go: os.Getenv("VAR")
  const goRe = /os\.Getenv\(\s*["']([A-Z][A-Z0-9_]+)["']/g;

  for (const f of files) {
    if (!f.content) continue;
    const ext = f.path.split(".").pop()?.toLowerCase() ?? "";
    const re =
      ext === "py" ? pythonRe :
      ext === "rs" ? rustRe :
      ext === "go" ? goRe :
      nodeRe;

    for (const m of f.content.matchAll(re)) {
      if (m[1]) vars.add(m[1]);
    }
  }

  // Prefer canonical name over legacy aliases
  if (vars.has("GEMINI_API_KEY")) vars.delete("GOOGLE_API_KEY");

  return Array.from(vars).sort();
}

// ─── Env example generator ───────────────────────────────────────────────────

export function generateEnvExample(files: ParsedFile[]): string | null {
  const vars = detectEnvVars(files);
  if (vars.length === 0) return null;
  return vars.map((v) => `${v}=`).join("\n") + "\n";
}

// ─── Package manager resolver ─────────────────────────────────────────────────

function resolvePackageManager(configFileName: string, cliScripts: string): string {
  if (configFileName === "Cargo.toml") return "cargo";
  if (configFileName === "go.mod") return "go";
  if (configFileName === "pyproject.toml" || configFileName === "requirements.txt") return "pip";
  if (configFileName === "pom.xml" || configFileName === "build.gradle") return "gradle";
  if (cliScripts.includes("yarn")) return "yarn";
  if (cliScripts.includes("pnpm")) return "pnpm";
  return "npm";
}

// ─── Key file selector ────────────────────────────────────────────────────────

/**
 * Regexes against filename (not full path) — higher score = more representative.
 * We want files that define the public API surface of the project.
 */
const KEY_FILE_PATTERNS: Array<{ re: RegExp; score: number }> = [
  { re: /cli\.(ts|js|py|go|rs)$/i, score: 30 },
  { re: /command[s]?\.(ts|js|py|go|rs)$/i, score: 28 },
  { re: /router?s?\.(ts|js|py|go|rs)$/i, score: 25 },
  { re: /api\.(ts|js|py|go|rs)$/i, score: 25 },
  { re: /server\.(ts|js|py|go|rs)$/i, score: 22 },
  { re: /app\.(ts|js|py|go|rs)$/i, score: 20 },
  { re: /handler[s]?\.(ts|js|py|go|rs)$/i, score: 20 },
  { re: /controller[s]?\.(ts|js|py|go|rs)$/i, score: 20 },
  { re: /config\.(ts|js|py|go|rs)$/i, score: 18 },
  { re: /service[s]?\.(ts|js|py|go|rs)$/i, score: 18 },
  { re: /model[s]?\.(ts|js|py|go|rs)$/i, score: 18 },
  { re: /schema[s]?\.(ts|js|py|go|rs)$/i, score: 16 },
  { re: /types?\.(ts|js)$/i, score: 14 },
  { re: /main\.(ts|js|py|go|rs)$/i, score: 12 },
];

// Extensions worth including (source code, not binary/generated)
const SOURCE_EXTS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "py", "rs", "go", "java", "kt",
  "rb", "php", "ex", "exs", "cs", "cpp", "c", "zig", "nim", "hs", "ml",
  "swift", "dart", "lua", "r",
]);

function pickKeyFiles(
  files: ParsedFile[],
  exclude: Set<string>,
  max = 4
): Array<{ filename: string; snippet: string }> {
  const scored = files
    .filter((f) => {
      if (exclude.has(f.path)) return false;
      if (!f.content || f.content.length < 30) return false;
      const ext = f.path.split(".").pop()?.toLowerCase() ?? "";
      return SOURCE_EXTS.has(ext);
    })
    .map((f) => {
      const basename = f.path.split("/").pop() ?? f.path;
      let score = 0;
      for (const { re, score: s } of KEY_FILE_PATTERNS) {
        if (re.test(basename)) { score = Math.max(score, s); }
      }
      // Tiebreak: prefer longer files (more content = more representative)
      return { file: f, score, len: f.content.length };
    })
    .sort((a, b) => b.score - a.score || b.len - a.len);

  return scored.slice(0, max).map(({ file }) => ({
    filename: file.path,
    // Pass full content for small files; use keySnippet (skip imports) for larger ones
    snippet: file.content.split("\n").length <= 80 ? file.content : keySnippet(file.content),
  }));
}

function headLines(content: string, n: number): string {
  return content.split("\n").slice(0, n).join("\n");
}

/**
 * Extract the most informative ~40 lines from a source file.
 * Skips the leading import block so the model sees actual logic/API definitions
 * rather than a wall of import statements.
 */
function keySnippet(content: string, lines = 60): string {
  const cleaned = stripLeadingAiComments(content);
  const all = cleaned.split("\n");

  // Find first line that looks like a real definition (not an import/declaration header).
  // Handles multi-line imports by looking for "export", "function", "class", etc.
  const DEF_RE = /^(export\s|function\s|class\s|const\s+\w+\s*[=:(<]|let\s+\w|var\s+\w|async\s+function|type\s+\w|interface\s+\w|def\s+\w|fn\s+\w|pub\s+(fn|struct|enum|impl|const)|impl\s+|struct\s+\w|enum\s+\w|#\[|@\w)/;

  let start = 0;
  for (let i = 0; i < all.length; i++) {
    const line = all[i] ?? "";
    if (DEF_RE.test(line.trimStart())) { start = i; break; }
  }

  // If nothing matched (e.g. pure barrel files), just take head
  if (start === 0 && all.length > 5) {
    // fall back to skipping simple single-line import lines
    for (let i = 0; i < all.length; i++) {
      const line = (all[i] ?? "").trim();
      if (line && !/^(import|from|require|#!|\/\/)/.test(line) && !line.startsWith("*")) {
        start = i;
        break;
      }
    }
  }

  // Safety: don't skip more than 60% of file
  if (start > all.length * 0.6) start = 0;

  return all.slice(start, start + lines).join("\n");
}

// ─── Workspace detection from directory ──────────────────────────────────────

export function detectWorkspacesFromDir(dir: string): WorkspacePackage[] {
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) return [];

  try {
    const raw = fs.readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as { workspaces?: string[] | { packages?: string[] } };
    const patterns = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages;
    if (!patterns || patterns.length === 0) return [];
  } catch {
    return [];
  }

  // Scan known workspace directories
  const packages: WorkspacePackage[] = [];
  const WORKSPACE_DIRS = ["packages", "apps", "libs", "modules", "services"];

  for (const wsDir of WORKSPACE_DIRS) {
    const wsPath = path.join(dir, wsDir);
    if (!fs.existsSync(wsPath)) continue;

    try {
      const entries = fs.readdirSync(wsPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const childPkgPath = path.join(wsPath, entry.name, "package.json");
        if (!fs.existsSync(childPkgPath)) continue;

        try {
          const childPkg = JSON.parse(fs.readFileSync(childPkgPath, "utf8")) as {
            name?: string; description?: string; version?: string;
          };
          packages.push({
            name: childPkg.name ?? entry.name,
            path: `${wsDir}/${entry.name}`,
            description: childPkg.description,
            version: childPkg.version,
          });
        } catch { /* skip */ }
      }
    } catch { /* skip unreadable */ }
  }

  return packages;
}

// ─── Glob filtering ───────────────────────────────────────────────────────────

const DEFAULT_AI_EXCLUDE = [".claude/**", "CLAUDE.md", ".env", ".env.*", "*.pem", "*.key"];
const DEFAULT_README_EXCLUDE = [".claude/**", "CLAUDE.md", "*.lock", ".env*"];
// Always excluded from git regardless of user config — internal Claude Code files
const ALWAYS_GIT_EXCLUDE = ["CLAUDE.md", ".claude/**"];

function compileGlob(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\uFFFD")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\uFFFD\//g, "(?:[^/]+/)*")
    .replace(/\uFFFD/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export function matchesGlob(filePath: string, pattern: string): boolean {
  const re = compileGlob(pattern);
  if (re.test(filePath)) return true;
  // Patterns without path separators also match against basename
  if (!pattern.includes("/") && !pattern.includes("**")) {
    const basename = filePath.split("/").pop() ?? filePath;
    if (re.test(basename)) return true;
  }
  return false;
}

function matchesAny(filePath: string, patterns: string[]): boolean {
  return patterns.some((p) => matchesGlob(filePath, p));
}

/**
 * Apply gitInclude/gitExclude patterns to a list of relative file paths.
 * include=[] means include all. Files matching exclude are always dropped.
 */
export function filterFilesForGit(
  files: string[],
  include: string[] = [],
  exclude: string[] = []
): string[] {
  return files.filter((f) => {
    if (matchesAny(f, ALWAYS_GIT_EXCLUDE)) return false;
    if (exclude.length > 0 && matchesAny(f, exclude)) return false;
    if (include.length > 0) return matchesAny(f, include);
    return true;
  });
}

/**
 * Filter file paths for AI context. Uses saved aiExcludePatterns, falling back
 * to DEFAULT_AI_EXCLUDE when none are configured.
 */
export function filterFilesForAI(files: string[], patterns?: string[]): string[] {
  const exclude = patterns ?? DEFAULT_AI_EXCLUDE;
  return files.filter((f) => !matchesAny(f, exclude));
}

/**
 * Filter file paths for README context. Uses saved readmeExcludePatterns,
 * falling back to DEFAULT_README_EXCLUDE when none are configured.
 */
export function filterFilesForReadme(files: string[], patterns?: string[]): string[] {
  const exclude = patterns ?? DEFAULT_README_EXCLUDE;
  return files.filter((f) => !matchesAny(f, exclude));
}

/**
 * Patch placeholder GitHub URLs in package.json with the real owner/repo.
 * Replaces any `github.com/your-username/` occurrence with `github.com/{username}/`.
 * No-op if package.json is absent or contains no placeholder.
 */
export function patchPackageJsonUrls(
  outputDir: string,
  username: string,
): void {
  const pkgPath = path.join(outputDir, "package.json");
  if (!fs.existsSync(pkgPath)) return;

  const content = fs.readFileSync(pkgPath, "utf8");
  const updated = content.replace(/github\.com\/your-username\//g, `github.com/${username}/`);
  if (updated !== content) {
    fs.writeFileSync(pkgPath, updated, "utf8");
  }
}

// ─── LICENSE file generation ──────────────────────────────────────────────────

const LICENSE_TEXTS: Record<LicenseType, (author: string, year: number) => string> = {
  "MIT": (author, year) =>
`MIT License

Copyright (c) ${year} ${author}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`,

  "ISC": (author, year) =>
`ISC License

Copyright (c) ${year} ${author}

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.`,

  "Apache-2.0": (author, year) =>
`Apache License
Version 2.0, January 2004
http://www.apache.org/licenses/

Copyright (c) ${year} ${author}

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.`,

  "GPL-3.0": (author, year) =>
`GNU General Public License v3.0

Copyright (C) ${year} ${author}

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.`,

  "AGPL-3.0": (author, year) =>
`GNU Affero General Public License v3.0

Copyright (C) ${year} ${author}

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.`,

  "BSD-2-Clause": (author, year) =>
`BSD 2-Clause License

Copyright (c) ${year}, ${author}

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`,

  "BSD-3-Clause": (author, year) =>
`BSD 3-Clause License

Copyright (c) ${year}, ${author}

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`,

  "Unlicense": (_author, _year) =>
`This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any means.

In jurisdictions that recognize copyright laws, the author or authors of
this software dedicate any and all copyright interest in the software to
the public domain. We make this dedication for the benefit of the public
at large and to the detriment of our heirs and successors. We intend this
dedication to be an overt act of relinquishment in perpetuity of all
present and future rights to this software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.

For more information, please refer to <https://unlicense.org>`,

  "proprietary": (author, year) =>
`Copyright (c) ${year} ${author}. All rights reserved.

This software and its source code are proprietary and confidential.
Unauthorized copying, distribution, modification, or use of this software,
via any medium, is strictly prohibited without the express written permission
of the copyright holder.`,
};

/**
 * Generate the content of a LICENSE file.
 * Returns undefined for unknown license types.
 */
export function generateLicenseFile(
  license: LicenseType,
  author: string,
  year = new Date().getFullYear()
): string {
  return LICENSE_TEXTS[license](author, year);
}

/**
 * Write a LICENSE file to outputDir if license is configured and file doesn't already exist.
 */
export function writeLicenseFile(
  outputDir: string,
  license: LicenseType | undefined,
  author: string | undefined,
  year = new Date().getFullYear()
): void {
  if (!license) return;
  // Check for any existing LICENSE variant (LICENSE, LICENSE.md, LICENSE.txt, etc.)
  // so a custom license from parsed input is never overwritten.
  const hasExisting =
    fs.existsSync(outputDir) &&
    fs.readdirSync(outputDir).some((f) => /^LICENSE(\.[a-z]+)?$/i.test(f));
  if (hasExisting) return;
  const dest = path.join(outputDir, "LICENSE");
  const text = generateLicenseFile(license, author || "Contributors", year);
  fs.writeFileSync(dest, text, "utf8");
}

/**
 * Strip leading AI-generated comment lines from a code snippet.
 * Claude sometimes prepends "// This file..." or "# Generated by..." comments.
 */
export function stripLeadingAiComments(content: string): string {
  const lines = content.split("\n");
  const AI_COMMENT_RE = /^\s*(\/\/|#|--)\s*(this file|generated|auto-?generated|created by|written by)/i;
  let start = 0;
  while (start < lines.length && AI_COMMENT_RE.test(lines[start]!)) {
    start++;
  }
  return lines.slice(start).join("\n");
}

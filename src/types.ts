export interface ParsedFile {
  path: string;
  content: string;
  language?: string;
}

export interface ParseResult {
  files: ParsedFile[];
  rawBlocks: number;
}

export interface TechStack {
  name: string;
  frameworks: string[];
  languages: string[];
  packageManager: "npm" | "yarn" | "pnpm" | "pip" | "cargo" | "go" | "none";
  badges: Badge[];
  gitignorePreset: GitignorePreset;
  /** True when the project is itself implementing a new programming language */
  isNewLanguage?: boolean;
}

export interface Badge {
  label: string;
  message: string;
  color: string;
  logoName?: string;
}

export type GitignorePreset =
  | "node"
  | "python"
  | "rust"
  | "go"
  | "java"
  | "ruby"
  | "dart"
  | "csharp"
  | "php"
  | "cpp"
  | "generic";

export type Provider = "anthropic" | "gemini";

export type ReadmeDetail = "short" | "normal" | "large" | "carefully";

export type ReadmeStyle = "practical" | "balanced" | "marketing";

export type LicenseType =
  | "MIT"
  | "Apache-2.0"
  | "GPL-3.0"
  | "AGPL-3.0"
  | "BSD-2-Clause"
  | "BSD-3-Clause"
  | "ISC"
  | "Unlicense"
  | "proprietary";

export interface ReadmeSections {
  /** Default: true */
  screenshot?: boolean;
  /** Default: true */
  contributing?: boolean;
  /** Default: true */
  license?: boolean;
  /** Default: false */
  changelog?: boolean;
  /** Default: false */
  faq?: boolean;
  /** Default: false — star-history.com chart using GitHub username + repo name */
  starHistory?: boolean;
}

export interface AppConfig {
  // ── Encrypted secrets ────────────────────────────────────────────────────
  anthropicApiKey?: string;
  geminiApiKey?: string;
  githubToken?: string;
  // ── Plain settings ────────────────────────────────────────────────────────
  defaultProvider?: Provider;
  defaultPrivate?: boolean;
  githubUsername?: string;
  githubScopes?: string;
  /** GitHub OAuth App client_id for Device Flow (public, not a secret) */
  oauthClientId?: string;
  // ── File filters ──────────────────────────────────────────────────────────
  /** Glob patterns — only push matching files to GitHub (empty = push all) */
  gitIncludePatterns?: string[];
  /** Glob patterns — never push these files to GitHub */
  gitExcludePatterns?: string[];
  /** Glob patterns — never send these file paths/contents to AI APIs */
  aiExcludePatterns?: string[];
  /** Glob patterns — don't mention these in README generation */
  readmeExcludePatterns?: string[];
  // ── Push settings ─────────────────────────────────────────────────────────
  /** GitHub org to create repos under (empty = personal account) */
  defaultOrg?: string;
  /** Default git branch name for new repos (default: "main") */
  defaultBranch?: string;
  /** Use SSH remote URL (git@github.com:) instead of HTTPS */
  useSshRemote?: boolean;
  /** How detailed the generated README should be (default: "normal") */
  defaultReadmeDetail?: ReadmeDetail;
  // ── README customization ──────────────────────────────────────────────────
  /** License type for the License section (default: "MIT") */
  defaultLicense?: LicenseType;
  /** Author name for copyright line (default: GitHub username) */
  projectAuthor?: string;
  /** Which README sections to include */
  readmeSections?: ReadmeSections;
  /** Always generate Vietnamese README without needing --vi flag */
  defaultVi?: boolean;
  /** Default README style: practical | balanced (default) | marketing */
  defaultReadmeStyle?: ReadmeStyle;
  /** Max tokens for README generation. 0 = use provider maximum. Default per detail level. */
  maxReadmeTokens?: number;
}

export interface ShipConfig {
  githubToken: string;
  projectName: string;
  description: string;
  isPrivate: boolean;
  claudeResponse: string;
  anthropicApiKey?: string;
  generateVietnamese: boolean;
  outputDir: string;
}

export interface GitHubRepo {
  url: string;
  cloneUrl: string;
  sshUrl: string;
  name: string;
  fullName: string;
}

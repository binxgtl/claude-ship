import fs from "fs";
import path from "path";
import { detectTechStack } from "./detector.js";
import {
  extractReadmeContext,
  filterFilesForAI,
  filterFilesForReadme,
  generateEnvExample,
  getAllFilePaths,
  ReadmeContext,
} from "./scaffold.js";
import { ParsedFile, TechStack } from "./types.js";

export interface ProjectAnalysisOptions {
  aiExcludePatterns?: string[];
  readmeExcludePatterns?: string[];
  sampleLimit?: number;
}

export interface PackageMetadata {
  name?: string;
  description?: string;
  version?: string;
  packageManager?: string;
  lockfileName?: string;
  scripts?: Record<string, string>;
}

export interface ProjectAnalysis {
  allPaths: string[];
  hasTests: boolean;
  hasLintConfig: boolean;
  hasFormatConfig: boolean;
  getPackageMetadata(): PackageMetadata;
  getExistingReadme(): string | undefined;
  getSampleFiles(limit?: number): ParsedFile[];
  getProjectStack(): TechStack;
  getReadmePaths(): string[];
  getReadmeFiles(): ParsedFile[];
  getReadmeStack(): TechStack;
  getReadmeContext(): ReadmeContext;
  getEnvExample(): string | null;
}

function detectTests(paths: string[]): boolean {
  return paths.some((filePath) =>
    /\.(test|spec)\.(ts|js|tsx|jsx|py|rs|go)$/.test(filePath) || filePath.includes("__tests__")
  );
}

function detectLintConfig(paths: string[], files?: ParsedFile[]): boolean {
  const hasPathHint = paths.some((filePath) => filePath.includes("eslint") || filePath.includes(".ruff"));
  if (hasPathHint || !files) {
    return hasPathHint;
  }
  return files.some((file) => file.content.includes("eslint") || file.content.includes("ruff"));
}

function detectFormatConfig(paths: string[], files?: ParsedFile[]): boolean {
  const hasPathHint = paths.some(
    (filePath) => filePath.includes("prettier") || filePath.includes(".editorconfig")
  );
  if (hasPathHint || !files) {
    return hasPathHint;
  }
  return files.some((file) => file.content.includes("prettier"));
}

function detectLockfileName(paths: string[]): string | undefined {
  if (paths.includes("pnpm-lock.yaml")) return "pnpm-lock.yaml";
  if (paths.includes("yarn.lock")) return "yarn.lock";
  if (paths.includes("package-lock.json")) return "package-lock.json";
  if (paths.includes("npm-shrinkwrap.json")) return "npm-shrinkwrap.json";
  return undefined;
}

function resolveNodePackageManager(
  paths: string[],
  packageManagerField?: string
): string | undefined {
  const normalized = packageManagerField?.trim().toLowerCase() ?? "";
  if (normalized.startsWith("pnpm")) return "pnpm";
  if (normalized.startsWith("yarn")) return "yarn";
  if (normalized.startsWith("npm")) return "npm";

  const lockfile = detectLockfileName(paths);
  if (lockfile === "pnpm-lock.yaml") return "pnpm";
  if (lockfile === "yarn.lock") return "yarn";
  if (lockfile === "package-lock.json" || lockfile === "npm-shrinkwrap.json") return "npm";
  return undefined;
}

export function createProjectAnalysis(
  dir: string,
  opts: ProjectAnalysisOptions = {}
): ProjectAnalysis {
  const allPaths = getAllFilePaths(dir);
  const allPathSet = new Set(allPaths);
  const fileContentCache = new Map<string, string>();
  const parsedFileCache = new Map<string, ParsedFile>();
  const parsedListCache = new Map<string, ParsedFile[]>();
  const sampleFilesCache = new Map<number, ParsedFile[]>();
  const sampleLimit = opts.sampleLimit ?? 50;

  let packageMetadataCache: PackageMetadata | null | undefined;
  let existingReadmeCache: string | null | undefined;
  let projectStackCache: TechStack | undefined;
  let readmePathsCache: string[] | undefined;
  let readmeFilesCache: ParsedFile[] | undefined;
  let readmeStackCache: TechStack | undefined;
  let readmeContextCache: ReadmeContext | undefined;
  let envExampleCache: string | null | undefined;

  const readTextFile = (filePath: string): string => {
    const cached = fileContentCache.get(filePath);
    if (cached !== undefined) {
      return cached;
    }

    let content = "";
    try {
      content = fs.readFileSync(path.join(dir, filePath), "utf8");
    } catch {
      // Unreadable or binary files are ignored for analysis.
    }
    fileContentCache.set(filePath, content);
    return content;
  };

  const toParsedFile = (filePath: string): ParsedFile => {
    const cached = parsedFileCache.get(filePath);
    if (cached) {
      return cached;
    }

    const parsed: ParsedFile = {
      path: filePath,
      content: readTextFile(filePath),
      language: undefined,
    };
    parsedFileCache.set(filePath, parsed);
    return parsed;
  };

  const getParsedFiles = (paths: string[]): ParsedFile[] => {
    const key = paths.join("\0");
    const cached = parsedListCache.get(key);
    if (cached) {
      return cached;
    }

    const parsed = paths.map((filePath) => toParsedFile(filePath));
    parsedListCache.set(key, parsed);
    return parsed;
  };

  const getSampleFiles = (limit = sampleLimit): ParsedFile[] => {
    const cached = sampleFilesCache.get(limit);
    if (cached) {
      return cached;
    }

    const parsed = getParsedFiles(allPaths.slice(0, limit));
    sampleFilesCache.set(limit, parsed);
    return parsed;
  };

  const getPackageMetadata = (): PackageMetadata => {
    if (packageMetadataCache !== undefined) {
      return packageMetadataCache ?? {};
    }

    if (!allPathSet.has("package.json")) {
      packageMetadataCache = null;
      return {};
    }

    try {
      const pkg = JSON.parse(readTextFile("package.json")) as PackageMetadata & {
        packageManager?: string;
        scripts?: Record<string, string>;
      };
      packageMetadataCache = {
        name: pkg.name,
        description: pkg.description,
        version: pkg.version,
        packageManager: resolveNodePackageManager(allPaths, pkg.packageManager),
        lockfileName: detectLockfileName(allPaths),
        scripts: pkg.scripts ?? {},
      };
    } catch {
      packageMetadataCache = null;
    }

    return packageMetadataCache ?? {};
  };

  const getExistingReadme = (): string | undefined => {
    if (existingReadmeCache !== undefined) {
      return existingReadmeCache ?? undefined;
    }

    if (!allPathSet.has("README.md")) {
      existingReadmeCache = null;
      return undefined;
    }

    existingReadmeCache = readTextFile("README.md");
    return existingReadmeCache ?? undefined;
  };

  const getProjectStack = (): TechStack => {
    if (!projectStackCache) {
      projectStackCache = detectTechStack(getSampleFiles());
    }
    return projectStackCache;
  };

  const getReadmePaths = (): string[] => {
    if (!readmePathsCache) {
      const aiFiltered = filterFilesForAI(allPaths, opts.aiExcludePatterns);
      readmePathsCache = filterFilesForReadme(aiFiltered, opts.readmeExcludePatterns);
    }
    return readmePathsCache;
  };

  const getReadmeFiles = (): ParsedFile[] => {
    if (!readmeFilesCache) {
      readmeFilesCache = getParsedFiles(getReadmePaths());
    }
    return readmeFilesCache;
  };

  const getReadmeStack = (): TechStack => {
    if (!readmeStackCache) {
      readmeStackCache = detectTechStack(getReadmeFiles());
    }
    return readmeStackCache;
  };

  const getReadmeContext = (): ReadmeContext => {
    if (!readmeContextCache) {
      readmeContextCache = extractReadmeContext(getReadmeFiles());
    }
    return readmeContextCache;
  };

  const getEnvExample = (): string | null => {
    if (envExampleCache === undefined) {
      envExampleCache = generateEnvExample(getParsedFiles(allPaths));
    }
    return envExampleCache;
  };

  const hasTests = detectTests(allPaths);
  const hasLintConfig = detectLintConfig(allPaths);
  const hasFormatConfig = detectFormatConfig(allPaths);

  return {
    allPaths,
    hasTests,
    hasLintConfig,
    hasFormatConfig,
    getPackageMetadata,
    getExistingReadme,
    getSampleFiles,
    getProjectStack,
    getReadmePaths,
    getReadmeFiles,
    getReadmeStack,
    getReadmeContext,
    getEnvExample,
  };
}

export function createParsedProjectAnalysis(
  files: ParsedFile[],
  opts: ProjectAnalysisOptions = {}
): ProjectAnalysis {
  const allPaths = files.map((file) => file.path);
  const byPath = new Map(files.map((file) => [file.path, file]));
  const sampleLimit = opts.sampleLimit ?? 50;

  let packageMetadataCache: PackageMetadata | null | undefined;
  let existingReadmeCache: string | null | undefined;
  let projectStackCache: TechStack | undefined;
  let readmePathsCache: string[] | undefined;
  let readmeFilesCache: ParsedFile[] | undefined;
  let readmeStackCache: TechStack | undefined;
  let readmeContextCache: ReadmeContext | undefined;
  let envExampleCache: string | null | undefined;

  const getPackageMetadata = (): PackageMetadata => {
    if (packageMetadataCache !== undefined) {
      return packageMetadataCache ?? {};
    }

    const pkgFile = byPath.get("package.json");
    if (!pkgFile?.content) {
      packageMetadataCache = null;
      return {};
    }

    try {
      const pkg = JSON.parse(pkgFile.content) as PackageMetadata & {
        packageManager?: string;
        scripts?: Record<string, string>;
      };
      packageMetadataCache = {
        name: pkg.name,
        description: pkg.description,
        version: pkg.version,
        packageManager: resolveNodePackageManager(allPaths, pkg.packageManager),
        lockfileName: detectLockfileName(allPaths),
        scripts: pkg.scripts ?? {},
      };
    } catch {
      packageMetadataCache = null;
    }

    return packageMetadataCache ?? {};
  };

  const getExistingReadme = (): string | undefined => {
    if (existingReadmeCache !== undefined) {
      return existingReadmeCache ?? undefined;
    }

    existingReadmeCache = byPath.get("README.md")?.content ?? null;
    return existingReadmeCache ?? undefined;
  };

  const getSampleFiles = (limit = sampleLimit): ParsedFile[] => files.slice(0, limit);

  const getProjectStack = (): TechStack => {
    if (!projectStackCache) {
      projectStackCache = detectTechStack(getSampleFiles());
    }
    return projectStackCache;
  };

  const getReadmePaths = (): string[] => {
    if (!readmePathsCache) {
      const aiFiltered = filterFilesForAI(allPaths, opts.aiExcludePatterns);
      readmePathsCache = filterFilesForReadme(aiFiltered, opts.readmeExcludePatterns);
    }
    return readmePathsCache;
  };

  const getReadmeFiles = (): ParsedFile[] => {
    if (!readmeFilesCache) {
      readmeFilesCache = getReadmePaths()
        .map((filePath) => byPath.get(filePath))
        .filter((file): file is ParsedFile => Boolean(file));
    }
    return readmeFilesCache;
  };

  const getReadmeStack = (): TechStack => {
    if (!readmeStackCache) {
      readmeStackCache = detectTechStack(getReadmeFiles());
    }
    return readmeStackCache;
  };

  const getReadmeContext = (): ReadmeContext => {
    if (!readmeContextCache) {
      readmeContextCache = extractReadmeContext(getReadmeFiles());
    }
    return readmeContextCache;
  };

  const getEnvExample = (): string | null => {
    if (envExampleCache === undefined) {
      envExampleCache = generateEnvExample(files);
    }
    return envExampleCache;
  };

  return {
    allPaths,
    hasTests: detectTests(allPaths),
    hasLintConfig: detectLintConfig(allPaths, files),
    hasFormatConfig: detectFormatConfig(allPaths, files),
    getPackageMetadata,
    getExistingReadme,
    getSampleFiles,
    getProjectStack,
    getReadmePaths,
    getReadmeFiles,
    getReadmeStack,
    getReadmeContext,
    getEnvExample,
  };
}

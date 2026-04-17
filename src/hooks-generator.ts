import fs from "fs";
import path from "path";
import { GitignorePreset } from "./types.js";

export interface HooksOptions {
  gitignorePreset: GitignorePreset;
  packageManager: string;
  hasLint: boolean;
  hasFormat: boolean;
  hasTypecheck: boolean;
}

export interface HooksResult {
  huskyPreCommit: string;
  lintStagedConfig: Record<string, string | string[]>;
  packageJsonScripts: Record<string, string>;
  devDependencies: string[];
}

export interface AppliedHooksResult {
  packageJsonUpdated: boolean;
  warnings: string[];
  writtenFiles: string[];
}

const DEV_DEP_VERSIONS: Record<string, string> = {
  husky: "^9.1.0",
  "lint-staged": "^15.0.0",
};

export function generateHooksConfig(opts: HooksOptions): HooksResult | null {
  const supportsPackageJson = ["npm", "yarn", "pnpm"].includes(opts.packageManager);
  if (!supportsPackageJson) return null;
  if (!["node", "generic"].includes(opts.gitignorePreset)) return null;
  return nodeHooks(opts);
}

export function applyHooksConfig(projectDir: string, hooks: HooksResult): AppliedHooksResult {
  const writtenFiles: string[] = [];
  const warnings: string[] = [];

  const huskyPath = path.join(projectDir, ".husky", "pre-commit");
  fs.mkdirSync(path.dirname(huskyPath), { recursive: true });
  fs.writeFileSync(huskyPath, hooks.huskyPreCommit, "utf8");
  fs.chmodSync(huskyPath, 0o755);
  writtenFiles.push(".husky/pre-commit");

  if (Object.keys(hooks.lintStagedConfig).length > 0) {
    const lintStagedPath = path.join(projectDir, ".lintstagedrc.json");
    fs.writeFileSync(lintStagedPath, JSON.stringify(hooks.lintStagedConfig, null, 2) + "\n", "utf8");
    writtenFiles.push(".lintstagedrc.json");
  }

  const pkgPath = path.join(projectDir, "package.json");
  const needsPackageJson = Object.keys(hooks.packageJsonScripts).length > 0 || hooks.devDependencies.length > 0;
  if (!needsPackageJson) {
    return { packageJsonUpdated: false, warnings, writtenFiles };
  }

  if (!fs.existsSync(pkgPath)) {
    warnings.push("Hooks were generated, but package.json was not found so required devDependencies were not added.");
    return { packageJsonUpdated: false, warnings, writtenFiles };
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };

    const scripts = { ...(pkg.scripts ?? {}) };
    for (const [name, value] of Object.entries(hooks.packageJsonScripts)) {
      const existing = scripts[name];
      if (!existing) {
        scripts[name] = value;
        continue;
      }

      const parts = existing.split("&&").map((part) => part.trim());
      if (!parts.includes(value)) {
        scripts[name] = `${existing} && ${value}`;
      }
    }

    const dependencies = pkg.dependencies ?? {};
    const devDependencies = { ...(pkg.devDependencies ?? {}) };
    for (const dep of hooks.devDependencies) {
      if (!dependencies[dep] && !devDependencies[dep]) {
        devDependencies[dep] = DEV_DEP_VERSIONS[dep] ?? "latest";
      }
    }

    pkg.scripts = scripts;
    pkg.devDependencies = devDependencies;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");

    return { packageJsonUpdated: true, warnings, writtenFiles };
  } catch {
    warnings.push("Failed to update package.json for generated hooks.");
    return { packageJsonUpdated: false, warnings, writtenFiles };
  }
}

function nodeHooks(opts: HooksOptions): HooksResult {
  const pm = opts.packageManager;
  const run = pm === "yarn" ? "yarn" : pm === "pnpm" ? "pnpm" : "npx";

  const lintStagedConfig: Record<string, string | string[]> = {};
  if (opts.hasLint) {
    lintStagedConfig["*.{ts,tsx,js,jsx}"] = `${run} eslint --fix`;
  }
  if (opts.hasFormat) {
    lintStagedConfig["*.{ts,tsx,js,jsx,json,md,css}"] = `${run} prettier --write`;
  }
  if (!opts.hasLint && !opts.hasFormat) {
    lintStagedConfig["*.{ts,tsx,js,jsx}"] = `${run} eslint --fix`;
  }

  return {
    huskyPreCommit: [
      "#!/usr/bin/env sh",
      '. "$(dirname -- "$0")/_/husky.sh"',
      "",
      `${run} lint-staged`,
      "",
    ].join("\n"),
    lintStagedConfig,
    packageJsonScripts: { prepare: "husky" },
    devDependencies: ["husky", "lint-staged"],
  };
}

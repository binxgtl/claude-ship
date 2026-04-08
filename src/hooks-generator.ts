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

export function generateHooksConfig(opts: HooksOptions): HooksResult | null {
  if (opts.gitignorePreset === "python") return pythonHooks(opts);
  if (opts.gitignorePreset === "rust") return rustHooks();
  if (opts.gitignorePreset === "go") return goHooks();
  if (["node", "generic"].includes(opts.gitignorePreset)) return nodeHooks(opts);
  return null;
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
    huskyPreCommit: `#!/bin/sh\n${run} lint-staged\n`,
    lintStagedConfig,
    packageJsonScripts: { prepare: "husky" },
    devDependencies: ["husky", "lint-staged"],
  };
}

function pythonHooks(opts: HooksOptions): HooksResult {
  const lintStagedConfig: Record<string, string | string[]> = {};
  if (opts.hasFormat) {
    lintStagedConfig["*.py"] = ["black", "isort"];
  } else if (opts.hasLint) {
    lintStagedConfig["*.py"] = ["ruff check --fix", "ruff format"];
  } else {
    lintStagedConfig["*.py"] = ["ruff check --fix", "ruff format"];
  }

  return {
    huskyPreCommit: "#!/bin/sh\nnpx lint-staged\n",
    lintStagedConfig,
    packageJsonScripts: { prepare: "husky" },
    devDependencies: ["husky", "lint-staged"],
  };
}

function rustHooks(): HooksResult {
  return {
    huskyPreCommit: "#!/bin/sh\ncargo fmt -- --check && cargo clippy -- -D warnings\n",
    lintStagedConfig: {},
    packageJsonScripts: {},
    devDependencies: [],
  };
}

function goHooks(): HooksResult {
  return {
    huskyPreCommit: "#!/bin/sh\ngofmt -l . && go vet ./...\n",
    lintStagedConfig: {},
    packageJsonScripts: {},
    devDependencies: [],
  };
}

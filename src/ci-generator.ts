import { GitignorePreset } from "./types.js";

export interface CiOptions {
  gitignorePreset: GitignorePreset;
  packageManager: string;
  hasTests: boolean;
  files?: string[];
  packageScripts?: Record<string, string>;
}

export function generateCiWorkflow(opts: CiOptions): string {
  if (opts.gitignorePreset === "python") {
    return pythonCi(opts.hasTests, opts.files);
  }
  if (opts.gitignorePreset === "rust") {
    return rustCi(opts.hasTests);
  }
  if (opts.gitignorePreset === "go") {
    return goCi(opts.hasTests);
  }

  return nodeCi(opts.packageManager, opts.packageScripts, opts.files);
}

function hasFile(files: string[] | undefined, filePath: string): boolean {
  return files?.includes(filePath) ?? false;
}

function detectNodeLockfile(files: string[] | undefined): string | undefined {
  if (hasFile(files, "pnpm-lock.yaml")) return "pnpm-lock.yaml";
  if (hasFile(files, "yarn.lock")) return "yarn.lock";
  if (hasFile(files, "package-lock.json")) return "package-lock.json";
  if (hasFile(files, "npm-shrinkwrap.json")) return "npm-shrinkwrap.json";
  return undefined;
}

function runScript(pm: string, scriptName: string): string {
  if (pm === "yarn") return `yarn ${scriptName}`;
  if (pm === "pnpm") return `pnpm run ${scriptName}`;
  return `npm run ${scriptName}`;
}

function nodeInstallCommand(pm: string, lockfileName?: string): string {
  if (pm === "yarn") {
    return lockfileName === "yarn.lock" ? "yarn install --frozen-lockfile" : "yarn install";
  }
  if (pm === "pnpm") {
    return lockfileName === "pnpm-lock.yaml"
      ? "corepack enable && pnpm install --frozen-lockfile"
      : "corepack enable && pnpm install";
  }
  if (lockfileName === "package-lock.json" || lockfileName === "npm-shrinkwrap.json") {
    return "npm ci";
  }
  return "npm install";
}

function nodeCacheBlock(pm: string, lockfileName?: string): string {
  if (!lockfileName) return "";
  return `
          cache: ${pm === "yarn" ? "yarn" : pm === "pnpm" ? "pnpm" : "npm"}
          cache-dependency-path: ${lockfileName}`;
}

function nodeCi(
  pm: string,
  packageScripts: Record<string, string> | undefined,
  files: string[] | undefined
): string {
  const scripts = packageScripts ?? {};
  const lockfileName = detectNodeLockfile(files);
  const install = nodeInstallCommand(pm, lockfileName);
  const setupPnpm = pm === "pnpm" ? `
      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: latest` : "";

  const scriptSteps: string[] = [];
  if (scripts.lint) {
    scriptSteps.push(`
      - name: Lint
        run: ${runScript(pm, "lint")}`);
  }
  if (scripts.typecheck) {
    scriptSteps.push(`
      - name: Typecheck
        run: ${runScript(pm, "typecheck")}`);
  }
  if (scripts.build) {
    scriptSteps.push(`
      - name: Build
        run: ${runScript(pm, "build")}`);
  }
  if (scripts.test) {
    scriptSteps.push(`
      - name: Test
        run: ${runScript(pm, "test")}`);
  }

  return `name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest

    strategy:
      matrix:
        node-version: [20, 22]

    steps:
      - uses: actions/checkout@v4
${setupPnpm}
      - name: Setup Node.js \${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: \${{ matrix.node-version }}${nodeCacheBlock(pm, lockfileName)}

      - name: Install dependencies
        run: ${install}${scriptSteps.join("")}
`;
}

function pythonCi(hasTests: boolean, files?: string[]): string {
  let installCommands = `python -m pip install --upgrade pip`;
  if (hasFile(files, "requirements.txt")) {
    installCommands += `\n          pip install -r requirements.txt`;
  } else if (hasFile(files, "pyproject.toml")) {
    installCommands += `\n          pip install .`;
  }

  const testStep = hasTests ? `
      - name: Test
        run: pytest` : "";

  return `name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest

    strategy:
      matrix:
        python-version: ["3.11", "3.12", "3.13"]

    steps:
      - uses: actions/checkout@v4

      - name: Setup Python \${{ matrix.python-version }}
        uses: actions/setup-python@v5
        with:
          python-version: \${{ matrix.python-version }}

      - name: Install dependencies
        run: |
          ${installCommands}
${testStep}
`;
}

function rustCi(hasTests: boolean): string {
  const testStep = hasTests ? `
      - name: Test
        run: cargo test` : "";

  return `name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Cache cargo
        uses: actions/cache@v4
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            target
          key: \${{ runner.os }}-cargo-\${{ hashFiles('**/Cargo.lock') }}

      - name: Build
        run: cargo build --release

      - name: Clippy
        run: cargo clippy -- -D warnings
${testStep}
`;
}

function goCi(hasTests: boolean): string {
  const testStep = hasTests ? `
      - name: Test
        run: go test ./...` : "";

  return `name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Go
        uses: actions/setup-go@v5
        with:
          go-version: stable

      - name: Build
        run: go build ./...

      - name: Vet
        run: go vet ./...
${testStep}
`;
}

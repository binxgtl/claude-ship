import { GitignorePreset } from "./types.js";

export interface CiOptions {
  gitignorePreset: GitignorePreset;
  packageManager: string;
  hasTests: boolean;
}

export function generateCiWorkflow(opts: CiOptions): string {
  const pm = opts.packageManager;

  if (opts.gitignorePreset === "python") {
    return pythonCi(opts.hasTests);
  }
  if (opts.gitignorePreset === "rust") {
    return rustCi(opts.hasTests);
  }
  if (opts.gitignorePreset === "go") {
    return goCi(opts.hasTests);
  }

  return nodeCi(pm, opts.hasTests);
}

function nodeCi(pm: string, hasTests: boolean): string {
  const install = pm === "yarn" ? "yarn install --frozen-lockfile" :
    pm === "pnpm" ? "pnpm install --frozen-lockfile" :
    "npm ci";
  const setupPnpm = pm === "pnpm" ? `
      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: latest` : "";

  const testStep = hasTests ? `
      - name: Test
        run: ${pm === "yarn" ? "yarn test" : pm === "pnpm" ? "pnpm test" : "npm test"}` : "";

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
          node-version: \${{ matrix.node-version }}
          cache: ${pm === "yarn" ? "yarn" : pm === "pnpm" ? "pnpm" : "npm"}

      - name: Install dependencies
        run: ${install}

      - name: Build
        run: ${pm === "yarn" ? "yarn build" : pm === "pnpm" ? "pnpm build" : "npm run build"}
${testStep}
`;
}

function pythonCi(hasTests: boolean): string {
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
          python -m pip install --upgrade pip
          pip install -r requirements.txt
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

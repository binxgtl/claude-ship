import { GitignorePreset } from "./types.js";

export interface DockerOptions {
  gitignorePreset: GitignorePreset;
  packageManager: string;
  files?: string[];
  packageScripts?: Record<string, string>;
  entryFileName?: string;
}

export function generateDockerfile(opts: DockerOptions): string {
  if (opts.gitignorePreset === "python") return pythonDockerfile(opts.files);
  if (opts.gitignorePreset === "rust") return rustDockerfile(opts.files);
  if (opts.gitignorePreset === "go") return goDockerfile(opts.files);
  return nodeDockerfile(opts);
}

export function generateDockerCompose(opts: DockerOptions): string {
  const port = inferPort(opts);
  const portBlock = port ? `
    ports:
      - "\${PORT:-${port}}:${port}"` : "";

  return `services:
  app:
    build: .
${portBlock}
    restart: unless-stopped
`;
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

function packageJsonCopyBlock(lockfileName?: string): string {
  if (!lockfileName) return "COPY package.json ./";
  return `COPY package.json ./\nCOPY ${lockfileName} ./`;
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

function runScriptCommand(pm: string, scriptName: string, extraArgs: string[] = []): string[] {
  if (pm === "yarn") return ["yarn", scriptName, ...extraArgs];
  if (pm === "pnpm") return ["pnpm", "run", scriptName, ...(extraArgs.length > 0 ? ["--", ...extraArgs] : [])];
  return ["npm", "run", scriptName, ...(extraArgs.length > 0 ? ["--", ...extraArgs] : [])];
}

function inferHostArgs(scriptValue: string): string[] {
  if (/\bvite\b|\bastro\b/i.test(scriptValue)) return ["--host", "0.0.0.0"];
  if (/\bnext\s+(?:dev|start)\b/i.test(scriptValue)) return ["--hostname", "0.0.0.0"];
  if (/\bnuxt\b/i.test(scriptValue)) return ["--host", "0.0.0.0"];
  return [];
}

function resolveNodeEntry(files: string[] | undefined, entryFileName?: string): string | undefined {
  const candidates = [
    "dist/index.js",
    "build/index.js",
    "index.js",
    "src/index.js",
    "server.js",
    "app.js",
  ];
  const preferred = entryFileName && /\.(cjs|mjs|js)$/.test(entryFileName) ? [entryFileName] : [];
  for (const candidate of [...preferred, ...candidates]) {
    if (hasFile(files, candidate)) return candidate;
  }
  return undefined;
}

function resolveNodeCommand(opts: DockerOptions): string[] {
  const scripts = opts.packageScripts ?? {};
  if (scripts.start) {
    return runScriptCommand(opts.packageManager, "start");
  }
  if (scripts.preview) {
    return runScriptCommand(opts.packageManager, "preview", inferHostArgs(scripts.preview));
  }
  if (scripts.dev) {
    return runScriptCommand(opts.packageManager, "dev", inferHostArgs(scripts.dev));
  }

  const entry = resolveNodeEntry(opts.files, opts.entryFileName);
  if (entry) {
    return ["node", entry];
  }

  return ["node", "index.js"];
}

function inferPort(opts: DockerOptions): number | null {
  if (opts.gitignorePreset === "python") return 8000;
  if (opts.gitignorePreset === "go" || opts.gitignorePreset === "rust") return 8080;

  const scripts = opts.packageScripts ?? {};
  const scriptValues = Object.values(scripts).join(" ");
  if (/\bastro\b/i.test(scriptValues)) return 4321;
  if (/\bvite\b/i.test(scriptValues)) return 5173;
  if (scripts.start || scripts.dev || scripts.preview) return 3000;
  return null;
}

function nodeDockerfile(opts: DockerOptions): string {
  const hasPackageJson = hasFile(opts.files, "package.json");
  const lockfileName = detectNodeLockfile(opts.files);
  const install = nodeInstallCommand(opts.packageManager, lockfileName);
  const scripts = opts.packageScripts ?? {};
  const buildStep = scripts.build ? `RUN ${runScriptCommand(opts.packageManager, "build").join(" ")}` : "";
  const cmd = resolveNodeCommand(opts);
  const port = inferPort(opts);
  const exposeLine = port ? `EXPOSE ${port}` : "";

  if (!hasPackageJson) {
    return `FROM node:22-alpine
WORKDIR /app

COPY . .

${exposeLine}
CMD ${JSON.stringify(cmd)}
`;
  }

  return `FROM node:22-alpine
WORKDIR /app

${packageJsonCopyBlock(lockfileName)}
RUN ${install}

COPY . .
${buildStep}

ENV NODE_ENV=production
${exposeLine}
CMD ${JSON.stringify(cmd)}
`;
}

function pythonDockerfile(files?: string[]): string {
  const installStep = hasFile(files, "requirements.txt")
    ? "COPY requirements.txt ./\nRUN pip install --no-cache-dir -r requirements.txt"
    : hasFile(files, "pyproject.toml")
      ? "COPY pyproject.toml ./\nRUN pip install --no-cache-dir ."
      : "RUN python -m pip install --upgrade pip";

  return `FROM python:3.13-slim AS base
WORKDIR /app

${installStep}

COPY . .

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
`;
}

function rustDockerfile(files?: string[]): string {
  const cargoCopy = hasFile(files, "Cargo.lock")
    ? "COPY Cargo.toml Cargo.lock ./"
    : "COPY Cargo.toml ./";

  return `FROM rust:1.83-slim AS builder
WORKDIR /app
${cargoCopy}
RUN mkdir src && echo "fn main(){}" > src/main.rs && cargo build --release && rm -rf src

COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
COPY --from=builder /app/target/release/app /usr/local/bin/app
EXPOSE 8080
CMD ["app"]
`;
}

function goDockerfile(files?: string[]): string {
  const goCopy = hasFile(files, "go.sum")
    ? "COPY go.mod go.sum ./"
    : "COPY go.mod ./";

  return `FROM golang:1.23-alpine AS builder
WORKDIR /app
${goCopy}
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -o /bin/app .

FROM alpine:3.20
COPY --from=builder /bin/app /usr/local/bin/app
EXPOSE 8080
CMD ["app"]
`;
}

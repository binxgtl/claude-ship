import { GitignorePreset } from "./types.js";

export interface DockerOptions {
  gitignorePreset: GitignorePreset;
  packageManager: string;
  hasDevServer?: boolean;
}

export function generateDockerfile(opts: DockerOptions): string {
  if (opts.gitignorePreset === "python") return pythonDockerfile();
  if (opts.gitignorePreset === "rust") return rustDockerfile();
  if (opts.gitignorePreset === "go") return goDockerfile();
  return nodeDockerfile(opts.packageManager);
}

export function generateDockerCompose(opts: DockerOptions): string {
  const port = opts.gitignorePreset === "python" ? 8000
    : opts.gitignorePreset === "go" ? 8080
    : 3000;

  return `services:
  app:
    build: .
    ports:
      - "\${PORT:-${port}}:${port}"
    env_file:
      - .env
    restart: unless-stopped
`;
}

function nodeDockerfile(pm: string): string {
  const install = pm === "yarn" ? "yarn install --frozen-lockfile"
    : pm === "pnpm" ? "corepack enable && pnpm install --frozen-lockfile"
    : "npm ci";
  const lockfile = pm === "yarn" ? "yarn.lock"
    : pm === "pnpm" ? "pnpm-lock.yaml"
    : "package-lock.json";
  const start = pm === "yarn" ? "yarn start"
    : pm === "pnpm" ? "pnpm start"
    : "npm start";

  return `FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json ${lockfile} ./
RUN ${install}

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS production
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
EXPOSE 3000
CMD ${JSON.stringify(start.split(" "))}
`;
}

function pythonDockerfile(): string {
  return `FROM python:3.13-slim AS base
WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
`;
}

function rustDockerfile(): string {
  return `FROM rust:1.83-slim AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main(){}" > src/main.rs && cargo build --release && rm -rf src

COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
COPY --from=builder /app/target/release/app /usr/local/bin/app
EXPOSE 8080
CMD ["app"]
`;
}

function goDockerfile(): string {
  return `FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -o /bin/app .

FROM alpine:3.20
COPY --from=builder /bin/app /usr/local/bin/app
EXPOSE 8080
CMD ["app"]
`;
}

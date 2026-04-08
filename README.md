# claude-ship

[![npm version](https://img.shields.io/npm/v/@binxgodteli/claude-ship?style=flat-square&color=cb3837&logo=npm)](https://www.npmjs.com/package/@binxgodteli/claude-ship)
[![npm downloads](https://img.shields.io/npm/dm/@binxgodteli/claude-ship?style=flat-square&color=cb3837)](https://www.npmjs.com/package/@binxgodteli/claude-ship)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

**Language / Ngôn ngữ:** **English** | [Tiếng Việt](README_VI.md)

> Ship Claude-generated projects to GitHub in seconds — parse, scaffold, and publish with one command.

---

## Quick Start

```bash
# 1. Copy your Claude conversation to a file
# 2. Ship it to a new GitHub repo in one command
npx @binxgodteli/claude-ship ship --file ./claude-output.txt --name my-project

# Push an existing local project
npx @binxgodteli/claude-ship push --no-readme

# Regenerate your README with AI
npx @binxgodteli/claude-ship readme --provider gemini --api-key YOUR_KEY

# Scaffold a new project from a template (no Claude needed)
npx @binxgodteli/claude-ship init

# Generate CHANGELOG from git history
npx @binxgodteli/claude-ship changelog

# Login with OpenAI (free via ChatGPT subscription)
npx @binxgodteli/claude-ship login

# Batch process multiple Claude responses
npx @binxgodteli/claude-ship batch ./responses/

# AI-generated commit message from staged changes
npx @binxgodteli/claude-ship commit

# Bump version + changelog + GitHub Release
npx @binxgodteli/claude-ship release --bump minor
```

No setup required. `claude-ship` detects your GitHub token from the `gh` CLI, `GITHUB_TOKEN`, or a saved config automatically.

---

## Installation

```bash
# Run without installing (one-off use)
npx @binxgodteli/claude-ship --help

# Install globally
npm install -g @binxgodteli/claude-ship
claude-ship --help
```

---

## Features

- **Parse Claude output** — extracts files from fenced code blocks and `<antArtifact>` tags
- **Auto-scaffold** — writes files, generates `.gitignore` presets based on detected tech stack
- **4 AI providers** — Anthropic (Claude Sonnet 4.6), Google Gemini (3 Flash), OpenAI (GPT-5.4 via Codex OAuth or API key), and Ollama (local models)
- **AI README generation** — 4 detail levels, 3 tones, Vietnamese support; streaming output, AI self-evaluation with quality scoring, multi-provider fallback, and custom section preservation on regenerate
- **OpenAI Codex OAuth** — `login` command authenticates via browser using your ChatGPT subscription (free, no API key needed); configurable model (gpt-5.4, gpt-5.4-mini, gpt-5.3-codex)
- **GitHub integration** — creates repos (personal or org, public or private) via Octokit; handles force-push flow
- **Push existing projects** — no Claude output needed; creates repo if it doesn't exist
- **Project templates** — `init` command bootstraps new projects from 6 stack templates (Node.js, React, Next.js, Express, FastAPI, CLI Tool)
- **AI changelog** — `changelog` command generates CHANGELOG.md from git history using AI
- **Batch processing** — `batch` command processes multiple Claude response files into separate projects
- **AI commit messages** — `commit` command reads staged `git diff`, generates a conventional commit message, lets you review/edit/regenerate before committing
- **Release management** — `release` command bumps version, generates changelog, creates git tag, and publishes GitHub Release
- **Docker generation** — `--docker` flag generates `Dockerfile` and `docker-compose.yml` (multi-stage builds for Node/Python/Rust/Go)
- **`.env.example` generation** — `--env-example` flag detects environment variables and generates a `.env.example` template
- **Pre-commit hooks** — `--hooks` flag generates husky + lint-staged configuration
- **GitHub Actions CI** — auto-generate `.github/workflows/ci.yml` via `--ci` flag (Node.js, Python, Rust, Go)
- **Monorepo support** — detects npm/pnpm/yarn workspaces and includes package info in generated READMEs
- **Preview & diff** — `readme --preview` to review before writing; `push --diff` to see changes summary before pushing
- **Dry-run mode** — preview all actions without writing files or calling APIs
- **Encrypted config** — API keys and tokens stored with AES-256-GCM at `~/.claudeship/config.json` (machine-bound key)
- **SSH/HTTPS remotes** — configurable per project or globally

---

## Commands

### `ship` — Parse, scaffold, and publish

Parse a Claude response, scaffold a project directory, and push to a new GitHub repo.

```bash
npx @binxgodteli/claude-ship ship --file ./claude-output.txt --name my-project --desc "A project"

# Private repo with Gemini README + CI workflow
npx @binxgodteli/claude-ship ship --file ./output.txt --name my-project --private --provider gemini --api-key KEY --ci

# Preview without writing anything
npx @binxgodteli/claude-ship ship --file ./output.txt --name my-project -d
```

| Flag | Description |
| :--- | :---------- |
| `--file <path>` | Path to a file containing the Claude response |
| `--name <name>` | Project / repository name |
| `--desc <description>` | Short project description |
| `--out <dir>` | Output directory (default: `./<project-name>`) |
| `--private` | Create a private GitHub repository |
| `--no-readme` | Skip AI README generation |
| `--vi` | Generate README in Vietnamese |
| `--provider <name>` | AI provider: `anthropic`, `gemini`, `openai`, or `ollama` |
| `--api-key <key>` | API key for the selected provider |
| `--detail <level>` | README detail: `short`, `normal`, `large`, `carefully` |
| `--style <style>` | README tone: `practical`, `balanced` (default), `marketing` |
| `--max-tokens <n>` | Max tokens for README generation (`0` = no limit) |
| `--token <token>` | GitHub personal access token |
| `--org <org>` | GitHub organization to create the repo under |
| `--branch <name>` | Git branch name (default: `main`) |
| `--no-push` | Scaffold locally, skip GitHub push |
| `--ci` | Generate GitHub Actions CI workflow |
| `--docker` | Generate `Dockerfile` and `docker-compose.yml` |
| `--env-example` | Generate `.env.example` from detected env vars |
| `--hooks` | Generate pre-commit hooks (husky + lint-staged) |
| `-d, --dry-run` | Preview what would happen — no writes, no API calls |

---

### `push` — Push an existing project

Push a local project to GitHub. Creates the repo if it doesn't exist; handles diverged remotes interactively.

```bash
# Push current directory (keep existing README)
npx @binxgodteli/claude-ship push --no-readme

# Push with diff summary and CI generation
npx @binxgodteli/claude-ship push --diff --ci

# Push to an org as private
npx @binxgodteli/claude-ship push --org my-org --private --no-readme
```

| Flag | Description |
| :--- | :---------- |
| `--dir <path>` | Project directory (default: current working directory) |
| `--name <name>` | Repo name (default: from `package.json` or folder name) |
| `--desc <description>` | Repo description |
| `--private` | Create as private repo |
| `--no-readme` | Skip README regeneration |
| `--vi` | Generate README in Vietnamese |
| `--provider <name>` | AI provider: `anthropic`, `gemini`, `openai`, or `ollama` |
| `--api-key <key>` | API key for the selected provider |
| `--detail <level>` | README detail: `short`, `normal`, `large`, `carefully` |
| `--style <style>` | README tone: `practical`, `balanced`, `marketing` |
| `--max-tokens <n>` | Max tokens for README generation |
| `--token <token>` | GitHub personal access token |
| `--org <org>` | GitHub organization |
| `--branch <name>` | Branch name (default: `main`) |
| `--message <msg>` | Git commit message (default: `🚀 Update via claude-ship`) |
| `--diff` | Show changes summary and confirm before pushing |
| `--ci` | Generate GitHub Actions CI workflow |
| `--docker` | Generate `Dockerfile` and `docker-compose.yml` |
| `--env-example` | Generate `.env.example` from detected env vars |
| `--hooks` | Generate pre-commit hooks (husky + lint-staged) |

---

### `readme` — Regenerate README

Regenerate the README for an existing project directory. Supports streaming output, AI quality scoring, and custom section preservation.

```bash
npx @binxgodteli/claude-ship readme
npx @binxgodteli/claude-ship readme --dir ./my-project --provider gemini --vi --api-key KEY

# Preview in terminal before writing
npx @binxgodteli/claude-ship readme --preview
```

| Flag | Description |
| :--- | :---------- |
| `--dir <path>` | Project directory (default: current working directory) |
| `--provider <name>` | AI provider: `anthropic` (default), `gemini`, `openai`, or `ollama` |
| `--api-key <key>` | API key for the selected provider |
| `--vi` | Generate in Vietnamese |
| `--detail <level>` | Detail level: `short`, `normal`, `large`, `carefully` |
| `--style <style>` | Tone: `practical`, `balanced`, `marketing` |
| `--max-tokens <n>` | Max tokens (`0` = no limit) |
| `--preview` | Preview generated README in terminal before writing |

---

### `init` — Scaffold a new project

Interactively create a new project from a template — no Claude output needed.

```bash
npx @binxgodteli/claude-ship init
```

Available templates:

| Template | Stack |
| :------- | :---- |
| Node.js + TypeScript (ESM) | TypeScript, tsx |
| React + Vite + TypeScript | React 19, Vite 6 |
| Next.js (App Router) | Next.js 15, React 19 |
| Express API + TypeScript | Express 5, TypeScript |
| Python (FastAPI) | FastAPI, uvicorn |
| CLI Tool (Commander) | Commander.js, chalk |

Optionally generates a GitHub Actions CI workflow during scaffolding.

---

### `changelog` — Generate CHANGELOG from git history

Reads git commit history and uses AI to produce a CHANGELOG.md in [Keep a Changelog](https://keepachangelog.com) format.

```bash
npx @binxgodteli/claude-ship changelog
npx @binxgodteli/claude-ship changelog --dir ./my-project --provider gemini --api-key KEY
npx @binxgodteli/claude-ship changelog --count 50
```

| Flag | Description |
| :--- | :---------- |
| `--dir <path>` | Project directory (default: current working directory) |
| `--provider <name>` | AI provider: `anthropic`, `gemini`, `openai`, or `ollama` |
| `--api-key <key>` | API key for the selected provider |
| `--count <n>` | Max commits to include (default: 100) |

---

### `update` — Re-detect stack and update README

Re-scans an existing project, detects the tech stack, and regenerates the README while preserving custom sections.

```bash
npx @binxgodteli/claude-ship update
npx @binxgodteli/claude-ship update --dir ./my-project --vi
```

| Flag | Description |
| :--- | :---------- |
| `--dir <path>` | Project directory (default: current working directory) |
| `--provider <name>` | AI provider: `anthropic`, `gemini`, `openai`, or `ollama` |
| `--api-key <key>` | API key for the selected provider |
| `--vi` | Generate README in Vietnamese |
| `--detail <level>` | Detail level: `short`, `normal`, `large`, `carefully` |
| `--style <style>` | Tone: `practical`, `balanced`, `marketing` |
| `--max-tokens <n>` | Max tokens for README generation |

---

### `commit` — AI-generated commit messages

Generate a commit message from staged changes using AI. Supports review, edit, and regenerate before committing.

```bash
# Generate message from staged changes
npx @binxgodteli/claude-ship commit

# Stage all + commit + push in one go
npx @binxgodteli/claude-ship commit -a -p

# Skip confirmation (CI-friendly)
npx @binxgodteli/claude-ship commit -a -y
```

| Flag | Description |
| :--- | :---------- |
| `--dir <path>` | Project directory (default: current working directory) |
| `--provider <name>` | AI provider: `anthropic`, `gemini`, `openai`, or `ollama` |
| `--api-key <key>` | API key for the selected provider |
| `-a, --all` | Stage all changes before committing |
| `-p, --push` | Push to remote after committing |
| `-y, --yes` | Skip confirmation, commit immediately |

---

### `login` — Authenticate with OpenAI

Login with your ChatGPT account via OAuth to use OpenAI models for free (no API key required).

```bash
npx @binxgodteli/claude-ship login
```

Opens your browser for OpenAI authentication. Tokens are saved to `~/.claudeship/openai-auth.json` and used automatically when `--provider openai` is set. Also reads tokens from `~/.codex/auth.json` (created by `npx @openai/codex login`) as a fallback.

---

### `batch` — Process multiple files

Process multiple Claude response files from a directory into separate projects.

```bash
npx @binxgodteli/claude-ship batch ./responses/
npx @binxgodteli/claude-ship batch ./responses/ --private --ci --docker
```

| Flag | Description |
| :--- | :---------- |
| `<dir>` | Directory containing `.txt` or `.md` files with Claude responses |
| `--token <token>` | GitHub personal access token |
| `--private` | Create private repos |
| `--no-push` | Scaffold locally, skip GitHub push |
| `--provider <name>` | AI provider for README generation |
| `--api-key <key>` | API key for the selected provider |
| `--out <dir>` | Parent output directory (default: current working directory) |
| `--ci` | Generate GitHub Actions CI workflow |
| `--docker` | Generate Dockerfile and docker-compose.yml |

---

### `release` — Version bump + GitHub Release

Bump version in `package.json`, generate changelog, create git tag, push, and create a GitHub Release.

```bash
npx @binxgodteli/claude-ship release
npx @binxgodteli/claude-ship release --bump minor
npx @binxgodteli/claude-ship release --bump major --draft
```

| Flag | Description |
| :--- | :---------- |
| `--dir <path>` | Project directory (default: current working directory) |
| `--bump <type>` | Version bump: `patch` (default), `minor`, `major` |
| `--token <token>` | GitHub personal access token |
| `--provider <name>` | AI provider for changelog |
| `--api-key <key>` | API key for the selected provider |
| `--draft` | Create as draft release |

---

### `config` — Interactive setup

Launch a TUI to save API keys, GitHub tokens, and default preferences.

```bash
npx @binxgodteli/claude-ship config
```

Sections: **AI Keys** · **GitHub** (token or OAuth) · **Defaults** (privacy, org, branch) · **README** (detail, license, author) · **Files** (glob exclusion patterns)

---

## Configuration

Settings are stored in `~/.claudeship/config.json`. Manage them via `claude-ship config` or flags.

**GitHub token resolution order**: `--token` flag → `gh auth token` → `GITHUB_TOKEN` env → `GH_TOKEN` env → saved config.

### Environment Variables

| Variable | Description |
| :------- | :---------- |
| `GITHUB_TOKEN` / `GH_TOKEN` | GitHub Personal Access Token |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | Google Gemini API key |
| `OPENAI_API_KEY` | OpenAI API key (or use `claude-ship login` for OAuth) |
| `CLAUDE_SHIP_CLIENT_ID` | GitHub OAuth App client ID for device flow |

### Config File Fields

| Field | Description | Default |
| :---- | :---------- | :------ |
| `defaultProvider` | AI provider (`anthropic`, `gemini`, `openai`, `ollama`) | `anthropic` |
| `defaultPrivate` | Repo visibility | `false` |
| `githubUsername` | GitHub username | `""` |
| `defaultOrg` | GitHub organization | `""` |
| `defaultBranch` | Default branch name | `main` |
| `useSshRemote` | Use SSH remotes instead of HTTPS | `false` |
| `defaultReadmeDetail` | Default detail level | `normal` |
| `defaultLicense` | License type | `MIT` |
| `projectAuthor` | Author for copyright notices | `""` |
| `defaultVi` | Generate READMEs in Vietnamese | `false` |
| `maxReadmeTokens` | Max tokens for AI README (`0` = no limit) | `0` |
| `gitIncludePatterns` | Glob patterns to include in Git commits | `[]` |
| `gitExcludePatterns` | Glob patterns to exclude from Git commits | `[]` |
| `aiExcludePatterns` | Files never sent to AI (`.env*`, `*.key`, etc.) | `[]` |
| `readmeExcludePatterns` | Files excluded from README context | `[]` |
| `openaiModel` | OpenAI model name | `gpt-5.4` |
| `ollamaBaseUrl` | Ollama server URL | `http://localhost:11434` |
| `ollamaModel` | Ollama model name | `llama3.1` |

Encrypted fields: `anthropicApiKey`, `geminiApiKey`, `openaiApiKey`, `githubToken` (AES-256-GCM, machine-bound).

---

## Troubleshooting

**"No GitHub token found"** — Run `gh auth login`, set `GITHUB_TOKEN`, or run `claude-ship config`.

**AI key errors** — Verify your key in `claude-ship config` or pass `--api-key`. Check billing/quota on your provider's dashboard.

**Wrong files parsed** — Use `-d` (dry-run) to inspect. Ensure code blocks in the Claude response use standard fenced code blocks (` ``` `).

**Repo creation failed** — Confirm your token has the `repo` scope. Check the repo name isn't already taken. For orgs, verify you have write access.

---

## Contributing

1. Fork and clone the repo
2. `npm install`
3. Make changes, run `npm run lint` and `npm test`
4. Open a PR against `main`

---

## Star History

<p align="center">
  <a href="https://star-history.com/#binxgtl/claude-ship&Date">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=binxgtl/claude-ship&type=Date&theme=dark" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=binxgtl/claude-ship&type=Date" />
      <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=binxgtl/claude-ship&type=Date" width="600" />
    </picture>
  </a>
</p>

---

[MIT](LICENSE) © 2026 binxgtl

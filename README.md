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
- **AI README generation** — uses Anthropic Claude or Google Gemini; 4 detail levels, 3 tones, Vietnamese support
- **GitHub integration** — creates repos (personal or org, public or private) via Octokit; handles force-push flow
- **Push existing projects** — no Claude output needed; creates repo if it doesn't exist
- **Dry-run mode** — preview all actions without writing files or calling APIs
- **Encrypted config** — API keys and tokens stored with AES-256-CBC at `~/.claudeship/config.json`
- **SSH/HTTPS remotes** — configurable per project or globally

---

## Commands

### `ship` — Parse, scaffold, and publish

Parse a Claude response, scaffold a project directory, and push to a new GitHub repo.

```bash
npx @binxgodteli/claude-ship ship --file ./claude-output.txt --name my-project --desc "A project"

# Private repo with Gemini README
npx @binxgodteli/claude-ship ship --file ./output.txt --name my-project --private --provider gemini --api-key KEY

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
| `--provider <name>` | AI provider: `anthropic` or `gemini` |
| `--api-key <key>` | API key for the selected provider |
| `--detail <level>` | README detail: `short`, `normal`, `large`, `carefully` |
| `--style <style>` | README tone: `practical`, `balanced` (default), `marketing` |
| `--max-tokens <n>` | Max tokens for README generation (`0` = no limit) |
| `--token <token>` | GitHub personal access token |
| `--org <org>` | GitHub organization to create the repo under |
| `--branch <name>` | Git branch name (default: `main`) |
| `--no-push` | Scaffold locally, skip GitHub push |
| `-d, --dry-run` | Preview what would happen — no writes, no API calls |

---

### `push` — Push an existing project

Push a local project to GitHub. Creates the repo if it doesn't exist; handles diverged remotes interactively.

```bash
# Push current directory (keep existing README)
npx @binxgodteli/claude-ship push --no-readme

# Push a specific directory, regenerate README with AI
npx @binxgodteli/claude-ship push --dir ./my-project --provider gemini --api-key KEY

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
| `--provider <name>` | AI provider: `anthropic` or `gemini` |
| `--api-key <key>` | API key for the selected provider |
| `--detail <level>` | README detail: `short`, `normal`, `large`, `carefully` |
| `--style <style>` | README tone: `practical`, `balanced`, `marketing` |
| `--max-tokens <n>` | Max tokens for README generation |
| `--token <token>` | GitHub personal access token |
| `--org <org>` | GitHub organization |
| `--branch <name>` | Branch name (default: `main`) |
| `--message <msg>` | Git commit message (default: `🚀 Update via claude-ship`) |

---

### `readme` — Regenerate README

Regenerate the README for an existing project directory.

```bash
npx @binxgodteli/claude-ship readme
npx @binxgodteli/claude-ship readme --dir ./my-project --provider gemini --vi --api-key KEY
```

| Flag | Description |
| :--- | :---------- |
| `--dir <path>` | Project directory (default: current working directory) |
| `--provider <name>` | AI provider: `anthropic` (default) or `gemini` |
| `--api-key <key>` | API key for the selected provider |
| `--vi` | Generate in Vietnamese |
| `--detail <level>` | Detail level: `short`, `normal`, `large`, `carefully` |
| `--style <style>` | Tone: `practical`, `balanced`, `marketing` |
| `--max-tokens <n>` | Max tokens (`0` = no limit) |
| `--license <type>` | License type (e.g., `MIT`, `Apache-2.0`) |
| `--author <name>` | Author name for copyright line |
| `--github-username <name>` | GitHub username for star history chart |
| `--no-screenshot` | Skip screenshot placeholder section |

---

### `config` — Interactive setup

Launch a TUI to save API keys, GitHub tokens, and default preferences.

```bash
npx @binxgodteli/claude-ship config
```

Sections: **AI Keys** · **GitHub** (token or OAuth) · **Defaults** (privacy, org, branch) · **README** (detail, license, author) · **Files** (glob exclusion patterns)

---

### `name` — Set default repo name

```bash
npx @binxgodteli/claude-ship name my-default-repo
npx @binxgodteli/claude-ship name ""   # unset
```

---

## Configuration

Settings are stored in `~/.claudeship/config.json`. Manage them via `claude-ship config` or flags.

**GitHub token resolution order**: `--token` flag → `gh auth token` → `GITHUB_TOKEN` env → `GH_TOKEN` env → saved config.

### Environment Variables

| Variable | Description |
| :------- | :---------- |
| `GITHUB_TOKEN` / `GH_TOKEN` | GitHub Personal Access Token |
| `CLAUDE_SHIP_CLIENT_ID` | GitHub OAuth App client ID for device flow |

### Config File Fields

| Field | Description | Default |
| :---- | :---------- | :------ |
| `defaultProvider` | AI provider (`anthropic` or `gemini`) | `anthropic` |
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

Encrypted fields: `anthropicApiKey`, `geminiApiKey`, `githubToken` (AES-256-CBC).

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

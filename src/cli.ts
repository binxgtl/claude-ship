import { Command } from "commander";
import inquirer from "inquirer";
import fs from "fs";
import path from "path";
import { parseClaudeResponse, buildFileTree } from "./parser.js";
import { detectTechStack, getGitignoreContent } from "./detector.js";
import {
  generateReadme,
  generateReadmeFallback,
} from "./readme.js";
import { initAndCommit, addRemoteAndPush, resolveOutputDir } from "./git.js";
import { resolveGitHubToken, createGitHubRepo, validateGitHubToken } from "./github.js";
import {
  writeFiles,
  writeFile,
  readInputFile,
  getAllFilePaths,
  checkConflicts,
  extractReadmeContext,
  filterFilesForGit,
  filterFilesForAI,
  filterFilesForReadme,
  patchPackageJsonUrls,
  writeLicenseFile,
} from "./scaffold.js";
import {
  loadConfig,
  mergeConfig,
  resolveApiKey,
  resolveDefaultProvider,
} from "./config.js";
import { runConfigUI } from "./config-ui.js";
import {
  providerConsoleUrl,
  providerEnvVar,
  providerLabel,
} from "./providers.js";
import {
  printBanner,
  printFileTree,
  printSuccess,
  printError,
  printWarning,
  printInfo,
  printShipSummary,
  printDryRunSummary,
  spinner,
  readMultilineInput,
  c,
} from "./ui.js";
import type { Provider, ReadmeDetail } from "./types.js";

// ─── CLI definition ───────────────────────────────────────────────────────────

export function createCLI(): Command {
  const program = new Command();

  program
    .name("claude-ship")
    .description("Ship Claude-generated projects to GitHub in seconds")
    .version("1.0.0");

  // ── ship (default) ─────────────────────────────────────────────────────────
  program
    .command("ship", { isDefault: true })
    .description("Parse a Claude response and ship it to a new GitHub repo")
    .option("--file <path>", "Path to a text file containing the Claude response")
    .option("--token <token>", "GitHub personal access token")
    .option("--name <name>", "Project / repository name")
    .option("--desc <description>", "Short project description")
    .option("--private", "Create a private GitHub repository", false)
    .option("--no-readme", "Skip AI README (use built-in template)")
    .option("--vi", "Generate README in Vietnamese (native developer style)", false)
    .option(
      "--provider <name>",
      'AI provider: "anthropic" (Claude 3.5 Sonnet) or "gemini" (free). Falls back to saved default.'
    )
    .option("--api-key <key>", "API key for the selected provider")
    .option("--out <dir>", "Output directory (default: ./<project-name>)")
    .option("--no-push", "Scaffold files locally, skip GitHub push")
    .option("--org <org>", "GitHub organization to create the repo under (overrides saved default)")
    .option("--branch <name>", "Git branch name (default: main, or saved default)")
    .option(
      "--detail <level>",
      'README detail level: "short", "normal" (default), "large", "carefully"'
    )
    .option(
      "--max-tokens <n>",
      "Max output tokens for README generation. 0 = no limit (provider maximum). Default varies by --detail level."
    )
    .option("-d, --dry-run", "Preview what would be created — no writes, no API calls", false)
    .action(async (opts) => {
      try {
        await runShip(opts);
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ── readme ─────────────────────────────────────────────────────────────────
  program
    .command("readme")
    .description("Regenerate the README for an existing project")
    .option("--vi", "Generate in Vietnamese (native dev style)", false)
    .option("--dir <path>", "Project directory (default: cwd)", ".")
    .option(
      "--provider <name>",
      'AI provider: "anthropic" (default) or "gemini"',
      "anthropic"
    )
    .option("--api-key <key>", "API key for the selected provider")
    .option(
      "--detail <level>",
      'README detail level: "short", "normal", "large", "carefully"'
    )
    .option(
      "--max-tokens <n>",
      "Max output tokens for README generation. 0 = no limit."
    )
    .action(async (opts) => {
      try {
        await runReadme(opts);
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ── push ───────────────────────────────────────────────────────────────────
  program
    .command("push")
    .description("Push an existing local project to GitHub (creates repo if needed)")
    .option("--dir <path>", "Project directory (default: cwd)", ".")
    .option("--name <name>", "Repo name (default: from package.json or folder name)")
    .option("--desc <description>", "Repo description (default: from package.json)")
    .option("--private", "Create as private repo", false)
    .option("--token <token>", "GitHub personal access token")
    .option("--org <org>", "GitHub organization (overrides saved default)")
    .option("--branch <name>", "Branch name (default: main, or saved default)")
    .option("--no-readme", "Skip README regeneration (use existing)")
    .option("--vi", "Generate README in Vietnamese", false)
    .option(
      "--provider <name>",
      'AI provider: "anthropic" or "gemini"'
    )
    .option("--api-key <key>", "API key for the selected provider")
    .option(
      "--detail <level>",
      'README detail level: "short", "normal" (default), "large", "carefully"'
    )
    .option(
      "--max-tokens <n>",
      "Max output tokens for README generation. 0 = no limit."
    )
    .action(async (opts) => {
      try {
        await runPush(opts);
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ── config ─────────────────────────────────────────────────────────────────
  program
    .command("config")
    .description("Interactive config: manage API keys, GitHub token, and defaults")
    .action(async () => {
      try {
        await runConfigUI();
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  return program;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve the GitHub token and, if githubUsername is not yet saved in config,
 * fetch it from the GitHub API and persist it automatically.
 */
async function resolveTokenAndUsername(flagToken?: string): Promise<{ token: string; username: string }> {
  const token = await resolveGitHubToken(flagToken);
  const cfg = loadConfig();
  if (cfg.githubUsername) {
    return { token, username: cfg.githubUsername };
  }
  try {
    const info = await validateGitHubToken(token);
    mergeConfig({ githubUsername: info.username });
    return { token, username: info.username };
  } catch {
    return { token, username: "" };
  }
}

function validateProvider(raw: string): Provider {
  if (raw === "anthropic" || raw === "gemini") return raw;
  throw new Error(`Unknown provider "${raw}". Use "anthropic" or "gemini".`);
}

function resolveMaxTokens(flag?: string, configValue?: number): number | undefined {
  if (flag !== undefined) {
    const n = parseInt(flag, 10);
    return isNaN(n) ? undefined : n;
  }
  return configValue;
}

function resolveDetail(flag?: string): ReadmeDetail {
  const cfg = loadConfig().defaultReadmeDetail ?? "normal";
  const raw = flag ?? cfg;
  if (raw === "short" || raw === "normal" || raw === "large" || raw === "carefully") return raw;
  throw new Error(`Unknown detail level "${raw}". Use: short, normal, large, carefully.`);
}

/**
 * Resolve an API key for the given provider.
 * Priority: --api-key flag → env var → saved config → interactive first-run prompt.
 * When found interactively, the key is saved to ~/.claudeship/config.json.
 */
async function ensureApiKey(
  provider: Provider,
  flagValue?: string
): Promise<string | undefined> {
  const resolved = resolveApiKey(provider, flagValue);
  if (resolved) return resolved;

  const label = providerLabel(provider);
  const consoleUrl = providerConsoleUrl(provider);
  const envVar = providerEnvVar(provider);

  console.log();
  printInfo(`No ${label} API key found. Get one at: ${c.path(consoleUrl)}`);
  console.log(c.dim(`  (Or set the ${envVar} environment variable to skip this prompt)\n`));

  const { apiKey } = await inquirer.prompt<{ apiKey: string }>([
    {
      type: "password",
      name: "apiKey",
      message: `Enter your ${label} API key (blank = skip AI README):`,
      mask: "*",
    },
  ]);

  if (!apiKey.trim()) return undefined;

  const patch =
    provider === "anthropic"
      ? { anthropicApiKey: apiKey.trim() }
      : { geminiApiKey: apiKey.trim() };

  mergeConfig(patch);
  printSuccess(
    `API key saved to ~/.claudeship/config.json (AES-256 encrypted, machine-bound)`
  );
  console.log();

  return apiKey.trim();
}

// ─── Ship flow ────────────────────────────────────────────────────────────────

interface ShipOptions {
  file?: string;
  token?: string;
  name?: string;
  desc?: string;
  private: boolean;
  readme: boolean;
  vi: boolean;
  provider: string;
  apiKey?: string;
  out?: string;
  push: boolean;
  org?: string;
  branch?: string;
  detail?: string;
  maxTokens?: string;
  dryRun: boolean;
}

async function runShip(opts: ShipOptions) {
  await printBanner();

  const provider = validateProvider(opts.provider ?? resolveDefaultProvider());

  // 1. Collect Claude response ─────────────────────────────────────────────────
  let claudeResponse: string;
  if (opts.file) {
    claudeResponse = readInputFile(opts.file);
    printInfo(`Reading from ${c.path(opts.file)}`);
  } else {
    claudeResponse = await readMultilineInput(
      "Paste your Claude response containing ``` code blocks:"
    );
  }

  if (!claudeResponse.trim()) {
    throw new Error("No input received. Use --file or paste a Claude response.");
  }

  // 2. Parse ───────────────────────────────────────────────────────────────────
  const spinParse = spinner("Parsing Claude response…");
  const parseResult = parseClaudeResponse(claudeResponse);
  spinParse.stop();

  if (parseResult.files.length === 0) {
    throw new Error(
      "No files found in the response.\n" +
        "Ensure code blocks include a file path as the first line:\n\n" +
        "  ```tsx\n  src/components/Foo.tsx\n  <code>\n  ```\n\n" +
        "Or use a comment: // src/components/Foo.tsx"
    );
  }

  printSuccess(
    `Parsed ${c.bold(String(parseResult.files.length))} files` +
      ` from ${parseResult.rawBlocks} code blocks`
  );
  printFileTree(buildFileTree(parseResult.files));

  // 3. Detect stack ────────────────────────────────────────────────────────────
  const stack = detectTechStack(parseResult.files);
  printInfo(`Detected stack: ${c.bold(stack.name)}`);

  // 4. Interactive prompts for missing options ──────────────────────────────────
  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "projectName",
      message: "Project name (GitHub repo name):",
      when: !opts.name,
      validate: (v: string) =>
        /^[a-zA-Z0-9_.-]+$/.test(v.trim()) ||
        "Only letters, numbers, hyphens, dots, or underscores",
    },
    {
      type: "input",
      name: "description",
      message: "Short description:",
      default: "Built with Claude + claude-ship",
      when: !opts.desc,
    },
    {
      type: "confirm",
      name: "isPrivate",
      message: "Private repository?",
      default: false,
      when: opts.push && !opts.private && !opts.dryRun,
    },
    {
      type: "password",
      name: "githubToken",
      message: "GitHub token (blank = use gh CLI / GITHUB_TOKEN env):",
      when: opts.push && !opts.token && !opts.dryRun,
      mask: "*",
    },
  ]);

  const projectName = (opts.name ?? answers.projectName ?? "").trim();
  const description = (opts.desc ?? answers.description ?? "Built with claude-ship").trim();
  const isPrivate: boolean = opts.private || answers.isPrivate || false;
  const outputDir = opts.out ?? resolveOutputDir(projectName);

  // 5. Resolve README context ───────────────────────────────────────────────────
  const readmeContext = extractReadmeContext(parseResult.files);

  // ─── DRY RUN branch ─────────────────────────────────────────────────────────
  if (opts.dryRun) {
    const readmeSnippet = generateReadmeFallback({
      projectName,
      description,
      stack,
      files: parseResult.files.map((f) => f.path),
      context: readmeContext,
      vietnamese: opts.vi,
    });

    printDryRunSummary({
      projectName,
      outputDir,
      fileCount: parseResult.files.length,
      fileTree: buildFileTree(parseResult.files),
      stack: stack.name,
      readmeSnippet,
      provider: providerLabel(provider),
      vietnamese: opts.vi,
      wouldPush: opts.push,
    });

    process.exit(0);
  }

  // 6. Resolve API key (with first-run save flow) ──────────────────────────────
  let apiKey: string | undefined;
  if (opts.readme) {
    apiKey = await ensureApiKey(provider, opts.apiKey);
  }

  // 6b. Resolve GitHub token + username early so README URLs use the real username
  let earlyUsername = loadConfig().githubUsername ?? "";
  if (opts.push && !opts.dryRun && !earlyUsername) {
    try {
      const { username } = await resolveTokenAndUsername(opts.token ?? answers.githubToken);
      earlyUsername = username;
    } catch {
      // will fail again later with a proper error message
    }
  }

  // 7. Conflict detection ───────────────────────────────────────────────────────
  const conflicts = checkConflicts(outputDir, parseResult.files);
  if (conflicts.existing.length > 0) {
    console.log();
    printWarning(
      `${conflicts.existing.length} file(s) already exist in ${c.path(outputDir)}:`
    );
    conflicts.existing.slice(0, 10).forEach((p) => console.log(`  ${c.dim("•")} ${p}`));
    if (conflicts.existing.length > 10) {
      console.log(c.dim(`  …and ${conflicts.existing.length - 10} more`));
    }
    console.log();

    const { resolution } = await inquirer.prompt<{
      resolution: "overwrite" | "skip" | "abort";
    }>([
      {
        type: "list",
        name: "resolution",
        message: "How do you want to handle existing files?",
        choices: [
          { name: "Overwrite all  — replace every conflicting file", value: "overwrite" },
          { name: "Skip existing  — keep existing, only write new files", value: "skip" },
          { name: "Abort          — stop without writing anything", value: "abort" },
        ],
      },
    ]);

    if (resolution === "abort") {
      printInfo("Aborted. No files were written.");
      process.exit(0);
    }

    if (resolution === "skip") {
      parseResult.files = parseResult.files.filter(
        (f) => !conflicts.existing.includes(f.path)
      );
      printInfo(
        `Writing ${parseResult.files.length} new files, skipping ${conflicts.existing.length} existing.`
      );
    }
  }

  // 8. Write files to disk ──────────────────────────────────────────────────────
  const spinWrite = spinner(
    `Writing ${parseResult.files.length} files to ${c.path(outputDir)}…`
  );
  writeFiles(outputDir, parseResult.files);
  writeFile(outputDir, ".gitignore", getGitignoreContent(stack.gitignorePreset));
  spinWrite.succeed("Files written");

  // 9. Generate README ──────────────────────────────────────────────────────────
  const detail = resolveDetail(opts.detail);
  const shipCfg = loadConfig();
  const isVi = opts.vi || (shipCfg.defaultVi ?? false);
  const readmeFiles = filterFilesForReadme(
    filterFilesForAI(parseResult.files.map((f) => f.path), shipCfg.aiExcludePatterns),
    shipCfg.readmeExcludePatterns
  );

  let readmeContent: string;
  if (opts.readme && apiKey) {
    const label = providerLabel(provider);
    const spinReadme = spinner(
      `Generating ${opts.vi ? "Vietnamese " : ""}README via ${label}…`
    );
    try {
      readmeContent = await generateReadme({
        projectName,
        description,
        stack,
        files: readmeFiles,
        context: readmeContext,
        vietnamese: isVi,
        detail,
        license: shipCfg.defaultLicense,
        author: shipCfg.projectAuthor ?? (earlyUsername || shipCfg.githubUsername),
        sections: shipCfg.readmeSections,
        githubUsername: earlyUsername || shipCfg.githubUsername,
        maxTokens: resolveMaxTokens(opts.maxTokens, shipCfg.maxReadmeTokens),
        provider,
        apiKey,
      });
      spinReadme.succeed(`README generated via ${label}`);
    } catch (err) {
      spinReadme.warn("README generation failed — using built-in template");
      printWarning(err instanceof Error ? err.message : String(err));
      readmeContent = generateReadmeFallback({
        projectName,
        description,
        stack,
        files: readmeFiles,
        context: readmeContext,
        vietnamese: opts.vi,
      });
    }
  } else {
    readmeContent = generateReadmeFallback({
      projectName,
      description,
      stack,
      files: readmeFiles,
      context: readmeContext,
      vietnamese: opts.vi,
    });
    if (!apiKey && opts.readme) {
      printInfo(
        "No API key — using built-in README template. " +
          "Run `claude-ship config --set-anthropic <key>` to enable AI generation."
      );
    }
  }

  writeFile(outputDir, "README.md", readmeContent);
  printSuccess("README.md written");

  // Patch placeholder GitHub URLs in package.json using resolved username
  const effectiveShipUsername = earlyUsername || shipCfg.githubUsername;
  if (effectiveShipUsername) {
    patchPackageJsonUrls(outputDir, effectiveShipUsername);
  }

  // Write LICENSE file — default MIT if not explicitly configured
  writeLicenseFile(
    outputDir,
    shipCfg.defaultLicense ?? "MIT",
    shipCfg.projectAuthor ?? effectiveShipUsername
  );

  // 10. Git init + commit ───────────────────────────────────────────────────────
  const spinGit = spinner("Initializing git and committing…");
  const allFiles = getAllFilePaths(outputDir);
  const cfg = loadConfig();
  const gitFiles = filterFilesForGit(
    allFiles,
    cfg.gitIncludePatterns,
    cfg.gitExcludePatterns
  );
  await initAndCommit(outputDir, gitFiles);
  spinGit.succeed("Git initialized and committed");

  // 11. Push to GitHub (optional) ───────────────────────────────────────────────
  if (!opts.push) {
    printWarning(
      `Skipping GitHub push (--no-push). Files at: ${c.path(outputDir)}`
    );
    return;
  }

  let token: string;
  try {
    ({ token } = await resolveTokenAndUsername(opts.token ?? answers.githubToken));
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    printInfo(`Files scaffolded at: ${c.path(outputDir)}`);
    return;
  }

  const pushCfg = loadConfig();
  // Use freshly resolved username so README URLs are correct even on first run
  const targetOrg = opts.org ?? pushCfg.defaultOrg;
  const targetBranch = opts.branch ?? pushCfg.defaultBranch ?? "main";
  const useSSH = pushCfg.useSshRemote ?? false;

  const spinRepo = spinner(
    targetOrg
      ? `Creating repo under ${c.bold(targetOrg)}…`
      : "Creating GitHub repository…"
  );
  const { repo, wasExisting } = await createGitHubRepo(
    token, projectName, description, isPrivate, { org: targetOrg }
  );

  if (wasExisting) {
    spinRepo.warn(`Repo already exists: ${c.path(repo.url)}`);
    const { existingAction } = await inquirer.prompt<{ existingAction: "push" | "abort" }>([{
      type: "list",
      name: "existingAction",
      message: `${repo.fullName} already exists on GitHub. What do you want to do?`,
      choices: [
        { name: "Push to it  — add files on top of what's there", value: "push" },
        { name: "Abort       — stop here, keep local files", value: "abort" },
      ],
    }]);
    if (existingAction === "abort") {
      printInfo(`Aborted. Local files are at: ${c.path(outputDir)}`);
      return;
    }
  } else {
    spinRepo.succeed(`Repo created: ${c.path(repo.url)}`);
  }

  const remoteUrl = useSSH ? repo.sshUrl : repo.cloneUrl;
  const spinPush = spinner(`Pushing to ${c.bold(targetBranch)}…`);
  await addRemoteAndPush(outputDir, remoteUrl, targetBranch);
  spinPush.succeed(`Pushed to ${repo.fullName}:${targetBranch}`);

  printShipSummary({
    projectName,
    filesCount: gitFiles.length,
    repoUrl: repo.url,
    cloneUrl: repo.cloneUrl,
    stack: stack.name,
    vietnamese: opts.vi,
  });
}

// ─── Readme flow ──────────────────────────────────────────────────────────────

interface ReadmeRunOptions {
  vi: boolean;
  dir: string;
  provider: string;
  apiKey?: string;
  detail?: string;
  maxTokens?: string;
}

async function runReadme(opts: ReadmeRunOptions) {
  const provider = validateProvider(opts.provider);
  const detail = resolveDetail(opts.detail);
  const readmeCfgAll = loadConfig();
  const dir = fs.realpathSync(opts.dir);

  const apiKey = await ensureApiKey(provider, opts.apiKey);
  if (!apiKey) {
    throw new Error(
      `API key required for README generation.\n` +
        `Set ${providerEnvVar(provider)} or run:\n` +
        `  claude-ship config --set-${provider} <key>`
    );
  }

  const isVi = opts.vi || (readmeCfgAll.defaultVi ?? false);
  const allFiles = getAllFilePaths(dir);
  const readmeCfg = readmeCfgAll;
  const aiFiltered = filterFilesForAI(allFiles, readmeCfg.aiExcludePatterns);
  const readmeFiltered = filterFilesForReadme(aiFiltered, readmeCfg.readmeExcludePatterns);

  // Read actual file contents so extractReadmeContext gets real snippets
  const parsedFiles = readmeFiltered.map((f) => {
    let content = "";
    try { content = fs.readFileSync(path.join(dir, f), "utf8"); } catch { /* skip unreadable */ }
    return { path: f, content, language: undefined };
  });
  const stack = detectTechStack(parsedFiles);
  const context = extractReadmeContext(parsedFiles);

  let projectName = dir.split(/[/\\]/).pop() ?? "my-project";
  let description = "";
  try {
    const pkg = JSON.parse(
      fs.readFileSync(`${dir}/package.json`, "utf8")
    ) as { name?: string; description?: string };
    if (pkg.name) projectName = pkg.name;
    if (pkg.description) description = pkg.description;
  } catch {
    // no package.json — fine
  }

  const label = providerLabel(provider);
  const spinReadme = spinner(
    `Generating ${isVi ? "Vietnamese " : ""}README via ${label}…`
  );
  const content = await generateReadme({
    projectName,
    description,
    stack,
    files: readmeFiltered,
    context,
    vietnamese: isVi,
    detail,
    license: readmeCfg.defaultLicense,
    author: readmeCfg.projectAuthor ?? readmeCfg.githubUsername,
    sections: readmeCfg.readmeSections,
    githubUsername: readmeCfg.githubUsername,
    maxTokens: resolveMaxTokens(opts.maxTokens, readmeCfg.maxReadmeTokens),
    provider,
    apiKey,
  });
  spinReadme.succeed(`README generated via ${label}`);

  const outPath = `${dir}/README.md`;
  fs.writeFileSync(outPath, content, "utf8");
  printSuccess(`README written to ${c.path(outPath)}`);
}

// config command delegates entirely to runConfigUI() in config-ui.ts

// ─── Push flow ────────────────────────────────────────────────────────────────

interface PushOptions {
  dir: string;
  name?: string;
  desc?: string;
  private: boolean;
  token?: string;
  org?: string;
  branch?: string;
  readme: boolean;
  vi: boolean;
  provider?: string;
  apiKey?: string;
  detail?: string;
  maxTokens?: string;
}

async function runPush(opts: PushOptions) {
  await printBanner();

  const dir = fs.realpathSync(path.resolve(opts.dir));
  const cfg = loadConfig();

  // Resolve project name and description from package.json or folder name
  let projectName = opts.name ?? "";
  let description = opts.desc ?? "";
  if (!projectName || !description) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
        name?: string;
        description?: string;
      };
      if (!projectName && pkg.name) projectName = pkg.name;
      if (!description && pkg.description) description = pkg.description;
    } catch { /* no package.json */ }
  }
  if (!projectName) projectName = path.basename(dir);

  printInfo(`Project: ${c.bold(projectName)}  |  Dir: ${c.path(dir)}`);

  // Regenerate README if requested
  if (opts.readme) {
    const provider = validateProvider(opts.provider ?? resolveDefaultProvider());
    const apiKey = await ensureApiKey(provider, opts.apiKey);
    if (!apiKey) {
      printWarning("No API key found — skipping README generation. Run `claude-ship config` to save one.");
    } else {
      const allPaths = getAllFilePaths(dir);
      const aiFiltered = filterFilesForAI(allPaths, cfg.aiExcludePatterns);
      const readmeFiltered = filterFilesForReadme(aiFiltered, cfg.readmeExcludePatterns);
      const parsedFiles = readmeFiltered.map((f) => {
        let content = "";
        try { content = fs.readFileSync(path.join(dir, f), "utf8"); } catch { /* skip */ }
        return { path: f, content, language: undefined };
      });
      const stack = detectTechStack(parsedFiles);
      const context = extractReadmeContext(parsedFiles);
      const isVi = opts.vi || (cfg.defaultVi ?? false);
      const detail = resolveDetail(opts.detail);

      const spinReadme = spinner(`Generating ${isVi ? "Vietnamese " : ""}README…`);
      try {
        const readmeContent = await generateReadme({
          projectName,
          description,
          stack,
          files: readmeFiltered,
          context,
          vietnamese: isVi,
          detail,
          license: cfg.defaultLicense,
          author: cfg.projectAuthor ?? cfg.githubUsername,
          sections: cfg.readmeSections,
          githubUsername: cfg.githubUsername,
          maxTokens: resolveMaxTokens(opts.maxTokens, cfg.maxReadmeTokens),
          provider,
          apiKey,
        });
        fs.writeFileSync(path.join(dir, "README.md"), readmeContent, "utf8");
        spinReadme.succeed("README.md regenerated");
      } catch (err) {
        spinReadme.warn("README generation failed — keeping existing");
        printWarning(err instanceof Error ? err.message : String(err));
      }
    }
  }

  // Resolve token
  let token: string;
  try {
    token = await resolveGitHubToken(opts.token);
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    return;
  }

  const targetOrg = opts.org ?? cfg.defaultOrg;
  const targetBranch = opts.branch ?? cfg.defaultBranch ?? "main";
  const useSSH = cfg.useSshRemote ?? false;

  // Write LICENSE file — default MIT if not explicitly configured
  writeLicenseFile(dir, cfg.defaultLicense ?? "MIT", cfg.projectAuthor ?? cfg.githubUsername);

  // Commit current state
  const allFiles = getAllFilePaths(dir);
  const gitFiles = filterFilesForGit(allFiles, cfg.gitIncludePatterns, cfg.gitExcludePatterns);

  const spinCommit = spinner("Committing local changes…");
  await initAndCommit(dir, gitFiles, "🚀 Update via claude-ship");
  spinCommit.succeed(`Committed ${gitFiles.length} files`);

  // Create or reuse GitHub repo
  const spinRepo = spinner(
    targetOrg ? `Creating repo under ${c.bold(targetOrg)}…` : "Resolving GitHub repository…"
  );
  const { repo, wasExisting } = await createGitHubRepo(
    token, projectName, description, opts.private, { org: targetOrg }
  );

  if (wasExisting) {
    spinRepo.succeed(`Using existing repo: ${c.path(repo.url)}`);
  } else {
    spinRepo.succeed(`Repo created: ${c.path(repo.url)}`);
  }

  const remoteUrl = useSSH ? repo.sshUrl : repo.cloneUrl;
  const spinPush = spinner(`Pushing to ${c.bold(targetBranch)}…`);
  try {
    await addRemoteAndPush(dir, remoteUrl, targetBranch);
    spinPush.succeed(`Pushed to ${repo.fullName}:${targetBranch}`);
  } catch (pushErr) {
    const msg = pushErr instanceof Error ? pushErr.message : String(pushErr);
    const isRejected = msg.includes("rejected") || msg.includes("fetch first") || msg.includes("non-fast-forward");
    if (!isRejected) throw pushErr;

    spinPush.warn("Push rejected — remote has commits not in local history.");
    const { action } = await inquirer.prompt<{ action: "force" | "abort" }>([{
      type: "list",
      name: "action",
      message: "What do you want to do?",
      choices: [
        { name: "Force push  — overwrite remote with local (remote commits will be lost)", value: "force" },
        { name: "Abort       — keep remote as-is", value: "abort" },
      ],
    }]);

    if (action === "abort") {
      printInfo("Aborted. Local files are committed but not pushed.");
      return;
    }

    const spinForce = spinner("Force pushing…");
    await addRemoteAndPush(dir, remoteUrl, targetBranch, true);
    spinForce.succeed(`Force pushed to ${repo.fullName}:${targetBranch}`);
  }

  printShipSummary({
    projectName,
    filesCount: gitFiles.length,
    repoUrl: repo.url,
    cloneUrl: repo.cloneUrl,
    stack: "",
    vietnamese: false,
  });
}

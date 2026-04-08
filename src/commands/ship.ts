import inquirer from "inquirer";
import { parseClaudeResponse, buildFileTree } from "../parser.js";
import { detectTechStack, getGitignoreContent } from "../detector.js";
import { generateReadme, generateReadmeFallback } from "../readme.js";
import { initAndCommit, addRemoteAndPush } from "../git.js";
import { createGitHubRepo } from "../github.js";
import {
  writeFiles, writeFile, readInputFile, getAllFilePaths,
  checkConflicts, extractReadmeContext, filterFilesForGit,
  filterFilesForAI, filterFilesForReadme, patchPackageJsonUrls,
  writeLicenseFile, resolveOutputDir, generateEnvExample,
} from "../scaffold.js";
import { loadConfig, resolveDefaultProvider } from "../config.js";
import { providerLabel } from "../providers.js";
import {
  printBanner, printFileTree, printSuccess, printError,
  printWarning, printInfo, printShipSummary, printDryRunSummary,
  spinner, readMultilineInput, c,
} from "../ui.js";
import { generateCiWorkflow } from "../ci-generator.js";
import { generateDockerfile, generateDockerCompose } from "../docker-generator.js";
import { generateHooksConfig } from "../hooks-generator.js";
import {
  resolveTokenAndUsername, validateProvider, resolveFallback,
  printQuality, resolveMaxTokens, resolveDetail, resolveStyle, resolveProviderWithKey,
} from "../cli-helpers.js";

export interface ShipOptions {
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
  style?: string;
  dryRun: boolean;
  ci: boolean;
  docker: boolean;
  envExample: boolean;
  hooks: boolean;
}

export async function runShip(opts: ShipOptions) {
  await printBanner();

  let provider = validateProvider(opts.provider ?? resolveDefaultProvider());

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

  const stack = detectTechStack(parseResult.files);
  printInfo(`Detected stack: ${c.bold(stack.name)}`);

  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "projectName",
      message: "Project name (GitHub repo name):",
      when: !opts.name && !opts.dryRun,
      validate: (v: string) =>
        /^[a-zA-Z0-9_.-]+$/.test(v.trim()) ||
        "Only letters, numbers, hyphens, dots, or underscores",
    },
    {
      type: "input",
      name: "description",
      message: "Short description:",
      default: "Built with Claude + claude-ship",
      when: !opts.desc && !opts.dryRun,
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

  const projectName = (opts.name ?? answers.projectName ?? (opts.dryRun ? "my-project" : "")).trim();
  const description = (opts.desc ?? answers.description ?? "Built with claude-ship").trim();
  const isPrivate: boolean = opts.private || answers.isPrivate || false;
  const outputDir = opts.out ?? resolveOutputDir(projectName);

  const readmeContext = extractReadmeContext(parseResult.files);

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

  let apiKey: string | undefined;
  if (opts.readme) {
    const resolved = await resolveProviderWithKey(provider, opts.apiKey);
    if (resolved) { provider = resolved.provider; apiKey = resolved.apiKey; }
  }

  const cfg = loadConfig();
  let earlyUsername = cfg.githubUsername ?? "";
  if (opts.push && !opts.dryRun && !earlyUsername) {
    try {
      const { username } = await resolveTokenAndUsername(opts.token ?? answers.githubToken, cfg.githubUsername);
      earlyUsername = username;
    } catch {
      // will fail again later with a proper error message
    }
  }

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

  const spinWrite = spinner(
    `Writing ${parseResult.files.length} files to ${c.path(outputDir)}…`
  );
  writeFiles(outputDir, parseResult.files);
  writeFile(outputDir, ".gitignore", getGitignoreContent(stack.gitignorePreset));
  if (opts.ci) {
    const ciContent = generateCiWorkflow({
      gitignorePreset: stack.gitignorePreset,
      packageManager: stack.packageManager,
      hasTests: readmeContext.hasTests,
    });
    writeFile(outputDir, ".github/workflows/ci.yml", ciContent);
  }
  if (opts.docker) {
    const dockerOpts = { gitignorePreset: stack.gitignorePreset, packageManager: stack.packageManager };
    writeFile(outputDir, "Dockerfile", generateDockerfile(dockerOpts));
    writeFile(outputDir, "docker-compose.yml", generateDockerCompose(dockerOpts));
  }
  if (opts.envExample) {
    const envContent = generateEnvExample(parseResult.files);
    if (envContent) writeFile(outputDir, ".env.example", envContent);
  }
  if (opts.hooks) {
    const hasLint = parseResult.files.some((f) => f.path.includes("eslint") || f.content.includes("eslint"));
    const hasFormat = parseResult.files.some((f) => f.path.includes("prettier") || f.content.includes("prettier"));
    const hooksResult = generateHooksConfig({
      gitignorePreset: stack.gitignorePreset,
      packageManager: stack.packageManager,
      hasLint, hasFormat, hasTypecheck: false,
    });
    if (hooksResult) {
      writeFile(outputDir, ".husky/pre-commit", hooksResult.huskyPreCommit);
      if (Object.keys(hooksResult.lintStagedConfig).length > 0) {
        writeFile(outputDir, ".lintstagedrc.json", JSON.stringify(hooksResult.lintStagedConfig, null, 2) + "\n");
      }
    }
  }
  const extras = [opts.ci && "CI", opts.docker && "Docker", opts.hooks && "hooks"].filter(Boolean);
  spinWrite.succeed("Files written" + (extras.length > 0 ? ` (+ ${extras.join(", ")})` : ""));

  const detail = resolveDetail(opts.detail, cfg);
  const isVi = opts.vi || (cfg.defaultVi ?? false);
  const readmeFiles = filterFilesForReadme(
    filterFilesForAI(parseResult.files.map((f) => f.path), cfg.aiExcludePatterns),
    cfg.readmeExcludePatterns
  );

  let readmeContent: string;
  if (opts.readme && apiKey) {
    const label = providerLabel(provider);
    const fallback = resolveFallback(provider, cfg);
    const spinReadme = spinner(
      `Generating ${opts.vi ? "Vietnamese " : ""}README via ${label}…`
    );
    try {
      const readmeResult = await generateReadme({
        projectName,
        description,
        stack,
        files: readmeFiles,
        context: readmeContext,
        vietnamese: isVi,
        detail,
        style: resolveStyle(opts.style, cfg),
        license: cfg.defaultLicense,
        author: cfg.projectAuthor ?? (earlyUsername || cfg.githubUsername),
        sections: cfg.readmeSections,
        githubUsername: earlyUsername || cfg.githubUsername,
        maxTokens: resolveMaxTokens(opts.maxTokens, cfg.maxReadmeTokens),
        provider,
        apiKey,
        fallbackProvider: fallback?.provider,
        fallbackApiKey: fallback?.apiKey,
        onChunk: (chunk) => { spinReadme.stop(); process.stdout.write(chunk); },
      });
      readmeContent = readmeResult.content;
      console.log();
      spinReadme.succeed(`README generated via ${readmeResult.usedFallback ? providerLabel(fallback!.provider) : label}`);
      printQuality(readmeResult);
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
          "Run `claude-ship config` to save an API key and enable AI generation."
      );
    }
  }

  writeFile(outputDir, "README.md", readmeContent);
  printSuccess("README.md written");

  const effectiveShipUsername = earlyUsername || cfg.githubUsername;
  if (effectiveShipUsername) {
    patchPackageJsonUrls(outputDir, effectiveShipUsername);
  }

  writeLicenseFile(
    outputDir,
    cfg.defaultLicense ?? "MIT",
    cfg.projectAuthor ?? effectiveShipUsername
  );

  const spinGit = spinner("Initializing git and committing…");
  const allFiles = getAllFilePaths(outputDir);
  const gitFiles = filterFilesForGit(
    allFiles,
    cfg.gitIncludePatterns,
    cfg.gitExcludePatterns
  );
  await initAndCommit(outputDir, gitFiles);
  spinGit.succeed("Git initialized and committed");

  if (!opts.push) {
    printWarning(
      `Skipping GitHub push (--no-push). Files at: ${c.path(outputDir)}`
    );
    return;
  }

  let token: string;
  try {
    ({ token } = await resolveTokenAndUsername(opts.token ?? answers.githubToken, cfg.githubUsername));
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    printInfo(`Files scaffolded at: ${c.path(outputDir)}`);
    return;
  }

  const targetOrg = opts.org ?? cfg.defaultOrg;
  const targetBranch = opts.branch ?? cfg.defaultBranch ?? "main";
  const useSSH = cfg.useSshRemote ?? false;

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

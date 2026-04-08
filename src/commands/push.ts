import inquirer from "inquirer";
import fs from "fs";
import path from "path";
import { detectTechStack } from "../detector.js";
import { generateReadme } from "../readme.js";
import { initAndCommit, addRemoteAndPush } from "../git.js";
import { resolveGitHubToken, createGitHubRepo } from "../github.js";
import {
  writeFile, getAllFilePaths, extractReadmeContext,
  filterFilesForGit, filterFilesForAI, filterFilesForReadme,
  writeLicenseFile, generateEnvExample,
} from "../scaffold.js";
import { loadConfig, resolveDefaultProvider } from "../config.js";
import { providerLabel } from "../providers.js";
import {
  printBanner, printSuccess, printError, printWarning,
  printInfo, printShipSummary, spinner, c,
} from "../ui.js";
import { generateCiWorkflow } from "../ci-generator.js";
import { generateDockerfile, generateDockerCompose } from "../docker-generator.js";
import { generateHooksConfig } from "../hooks-generator.js";
import {
  validateProvider, resolveFallback, printQuality,
  resolveMaxTokens, resolveDetail, resolveStyle, ensureApiKey,
} from "../cli-helpers.js";
import { generateText } from "../providers.js";
import { simpleGit } from "simple-git";

export interface PushOptions {
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
  style?: string;
  message?: string;
  diff: boolean;
  ci: boolean;
  docker: boolean;
  envExample: boolean;
  hooks: boolean;
  aiCommit: boolean;
}

export async function runPush(opts: PushOptions) {
  await printBanner();

  const dir = fs.realpathSync(path.resolve(opts.dir));
  const cfg = loadConfig();

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

  const provider = validateProvider(opts.provider ?? resolveDefaultProvider());
  const apiKey = (opts.readme || opts.aiCommit) ? await ensureApiKey(provider, opts.apiKey) : undefined;

  if (opts.readme) {
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
      const detail = resolveDetail(opts.detail, cfg);

      const fallback = resolveFallback(provider, cfg);
      const readmePath = path.join(dir, "README.md");
      const existingReadme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, "utf8") : undefined;
      const spinReadme = spinner(`Generating ${isVi ? "Vietnamese " : ""}README…`);
      try {
        const readmeResult = await generateReadme({
          projectName,
          description,
          stack,
          files: readmeFiltered,
          context,
          vietnamese: isVi,
          detail,
          style: resolveStyle(opts.style, cfg),
          license: cfg.defaultLicense,
          author: cfg.projectAuthor ?? cfg.githubUsername,
          sections: cfg.readmeSections,
          githubUsername: cfg.githubUsername,
          maxTokens: resolveMaxTokens(opts.maxTokens, cfg.maxReadmeTokens),
          provider,
          apiKey,
          fallbackProvider: fallback?.provider,
          fallbackApiKey: fallback?.apiKey,
          existingReadme,
          onChunk: (chunk) => { spinReadme.stop(); process.stdout.write(chunk); },
        });
        console.log();
        fs.writeFileSync(readmePath, readmeResult.content, "utf8");
        spinReadme.succeed("README.md regenerated");
        printQuality(readmeResult);
      } catch (err) {
        spinReadme.warn("README generation failed — keeping existing");
        printWarning(err instanceof Error ? err.message : String(err));
      }
    }
  }

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

  writeLicenseFile(dir, cfg.defaultLicense ?? "MIT", cfg.projectAuthor ?? cfg.githubUsername);

  if (opts.ci) {
    const allPaths = getAllFilePaths(dir);
    const parsedForDetect = allPaths.slice(0, 50).map((f) => {
      let content = "";
      try { content = fs.readFileSync(path.join(dir, f), "utf8"); } catch { /* skip */ }
      return { path: f, content, language: undefined };
    });
    const stackForCi = detectTechStack(parsedForDetect);
    const hasTests = allPaths.some((f) => /\.(test|spec)\.(ts|js|tsx|jsx|py|rs|go)$/.test(f));
    const ciContent = generateCiWorkflow({
      gitignorePreset: stackForCi.gitignorePreset,
      packageManager: stackForCi.packageManager,
      hasTests,
    });
    writeFile(dir, ".github/workflows/ci.yml", ciContent);
    printSuccess("GitHub Actions CI workflow generated");
  }

  if (opts.docker) {
    const allPaths = getAllFilePaths(dir);
    const parsedForDetect = allPaths.slice(0, 50).map((f) => {
      let content = "";
      try { content = fs.readFileSync(path.join(dir, f), "utf8"); } catch { /* skip */ }
      return { path: f, content, language: undefined };
    });
    const stackForDocker = detectTechStack(parsedForDetect);
    const dockerOpts = { gitignorePreset: stackForDocker.gitignorePreset, packageManager: stackForDocker.packageManager };
    writeFile(dir, "Dockerfile", generateDockerfile(dockerOpts));
    writeFile(dir, "docker-compose.yml", generateDockerCompose(dockerOpts));
    printSuccess("Dockerfile and docker-compose.yml generated");
  }

  if (opts.envExample) {
    const allPaths = getAllFilePaths(dir);
    const parsedForEnv = allPaths.map((f) => {
      let content = "";
      try { content = fs.readFileSync(path.join(dir, f), "utf8"); } catch { /* skip */ }
      return { path: f, content, language: undefined };
    });
    const envContent = generateEnvExample(parsedForEnv);
    if (envContent) {
      writeFile(dir, ".env.example", envContent);
      printSuccess(".env.example generated");
    } else {
      printInfo("No environment variables detected — skipping .env.example");
    }
  }

  if (opts.hooks) {
    const allPaths = getAllFilePaths(dir);
    const parsedForHooks = allPaths.slice(0, 50).map((f) => {
      let content = "";
      try { content = fs.readFileSync(path.join(dir, f), "utf8"); } catch { /* skip */ }
      return { path: f, content, language: undefined };
    });
    const stackForHooks = detectTechStack(parsedForHooks);
    const hasLint = allPaths.some((f) => f.includes("eslint") || f.includes(".ruff"));
    const hasFormat = allPaths.some((f) => f.includes("prettier") || f.includes(".editorconfig"));
    const hooksResult = generateHooksConfig({
      gitignorePreset: stackForHooks.gitignorePreset,
      packageManager: stackForHooks.packageManager,
      hasLint, hasFormat, hasTypecheck: false,
    });
    if (hooksResult) {
      writeFile(dir, ".husky/pre-commit", hooksResult.huskyPreCommit);
      if (Object.keys(hooksResult.lintStagedConfig).length > 0) {
        writeFile(dir, ".lintstagedrc.json", JSON.stringify(hooksResult.lintStagedConfig, null, 2) + "\n");
      }
      printSuccess("Pre-commit hooks generated");
    }
  }

  if (opts.diff) {
    const { simpleGit } = await import("simple-git");
    const git = simpleGit(dir);
    const status = await git.status();
    const modified = status.modified.length;
    const created = status.not_added.length + status.created.length;
    const deleted = status.deleted.length;

    console.log();
    printInfo("Changes summary:");
    if (modified > 0) console.log(`  ${c.dim("~")} ${modified} modified`);
    if (created > 0)  console.log(`  ${c.dim("+")} ${created} new`);
    if (deleted > 0)  console.log(`  ${c.dim("-")} ${deleted} deleted`);
    if (modified + created + deleted === 0) {
      console.log(`  ${c.dim("(no changes)")}`);
    }
    console.log();

    const { proceed } = await inquirer.prompt<{ proceed: boolean }>([{
      type: "confirm",
      name: "proceed",
      message: "Proceed with commit and push?",
      default: true,
    }]);
    if (!proceed) {
      printInfo("Aborted.");
      return;
    }
  }

  const allFiles = getAllFilePaths(dir);
  const gitFiles = filterFilesForGit(allFiles, cfg.gitIncludePatterns, cfg.gitExcludePatterns);

  let commitMessage = opts.message?.trim() || "";

  if (!commitMessage && opts.aiCommit && apiKey) {
    const spinAi = spinner("Generating commit message with AI…");
    try {
      const git = simpleGit(dir);
      await git.add(gitFiles.length > 0 ? gitFiles : ["-A"]);

      // Try remote diff first (what changed since last push), fall back to local staged diff
      let diffContent = "";
      let diffSource = "staged";
      const branch = targetBranch;
      try {
        await git.fetch(["origin", branch]);
        diffContent = await git.diff([`origin/${branch}...HEAD`]);
        if (diffContent) diffSource = `origin/${branch}`;
      } catch { /* no remote or fetch failed */ }

      if (!diffContent) {
        diffContent = await git.diff(["--staged"]).catch(() => "");
      }

      // Also get list of changed files
      let changedFiles: string[] = [];
      if (diffSource !== "staged") {
        const logResult = await git.diff(["--name-status", `origin/${branch}...HEAD`]).catch(() => "");
        changedFiles = logResult.split("\n").filter(Boolean);
      }
      if (changedFiles.length === 0) {
        const status = await git.status();
        changedFiles = status.staged.map((f) => {
          if (status.created.includes(f)) return `A\t${f}`;
          if (status.deleted.includes(f)) return `D\t${f}`;
          return `M\t${f}`;
        });
      }

      const truncated = diffContent.length > 8000 ? diffContent.slice(0, 8000) + "\n... (truncated)" : diffContent;

      const prompt = `You are a git commit message generator. Analyze the diff and write a single conventional commit message.
Rules:
- Format: type(scope): description
- Types: feat, fix, refactor, docs, style, test, chore, perf, ci, build
- Lowercase, imperative mood, no period, under 72 chars first line
- If substantial, add blank line then 2-3 bullet points max
- Output ONLY the commit message

Changed files (compared to ${diffSource}):
${changedFiles.join("\n")}

Diff:
${truncated || "(no diff)"}`;

      commitMessage = await generateText({ provider, apiKey, prompt, maxTokens: 256 });
      commitMessage = commitMessage.trim().replace(/^```\n?/, "").replace(/\n?```$/, "").trim();
      spinAi.succeed(`AI commit (vs ${diffSource}): ${c.accent(commitMessage.split("\n")[0]!)}`);
    } catch (err) {
      spinAi.warn(`AI commit message failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!commitMessage && opts.aiCommit && !apiKey) {
    printWarning("No API key — cannot generate AI commit message. Run `claude-ship config` to set one.");
  }

  if (!commitMessage) commitMessage = "🚀 Update via claude-ship";

  const spinCommit = spinner("Committing local changes…");
  await initAndCommit(dir, gitFiles, commitMessage);
  spinCommit.succeed(`Committed ${gitFiles.length} files`);

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

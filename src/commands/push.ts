import inquirer from "inquirer";
import fs from "fs";
import path from "path";
import { simpleGit } from "simple-git";
import { generateReadme } from "../readme.js";
import { initAndCommit, addRemoteAndPush, getStagedChangeContext } from "../git.js";
import { resolveGitHubToken, createGitHubRepo } from "../github.js";
import {
  writeFile,
  filterFilesForGit,
  writeLicenseFile,
} from "../scaffold.js";
import { loadConfig, resolveDefaultProvider } from "../config.js";
import { generateText } from "../providers.js";
import {
  printBanner,
  printSuccess,
  printError,
  printWarning,
  printInfo,
  printShipSummary,
  spinner,
  c,
} from "../ui.js";
import { generateCiWorkflow } from "../ci-generator.js";
import { generateDockerfile, generateDockerCompose } from "../docker-generator.js";
import { generateHooksConfig, applyHooksConfig } from "../hooks-generator.js";
import {
  validateProvider,
  resolveFallback,
  printQuality,
  resolveMaxTokens,
  resolveDetail,
  resolveStyle,
  resolveProviderWithKey,
} from "../cli-helpers.js";
import { createProjectAnalysis } from "../project-analysis.js";

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
  const analysis = createProjectAnalysis(dir, {
    aiExcludePatterns: cfg.aiExcludePatterns,
    readmeExcludePatterns: cfg.readmeExcludePatterns,
  });
  const pkgMeta = analysis.getPackageMetadata();

  const projectName = opts.name ?? pkgMeta.name ?? path.basename(dir);
  const description = opts.desc ?? pkgMeta.description ?? "";

  printInfo(`Project: ${c.bold(projectName)}  |  Dir: ${c.path(dir)}`);

  let provider = validateProvider(opts.provider ?? resolveDefaultProvider());
  let apiKey: string | undefined;
  if (opts.readme || opts.aiCommit) {
    const resolved = await resolveProviderWithKey(provider, opts.apiKey);
    if (resolved) {
      provider = resolved.provider;
      apiKey = resolved.apiKey;
    }
  }

  if (opts.readme) {
    if (!apiKey) {
      printWarning("No API key found - skipping README generation. Run `claude-ship config` to save one.");
    } else {
      const readmePaths = analysis.getReadmePaths();
      const stack = analysis.getReadmeStack();
      const context = analysis.getReadmeContext();
      const isVi = opts.vi || (cfg.defaultVi ?? false);
      const detail = resolveDetail(opts.detail, cfg);

      const fallback = resolveFallback(provider, cfg);
      const readmePath = path.join(dir, "README.md");
      const existingReadme = analysis.getExistingReadme();
      const spinReadme = spinner(`Generating ${isVi ? "Vietnamese " : ""}README...`);
      try {
        const readmeResult = await generateReadme({
          projectName,
          description,
          stack,
          files: readmePaths,
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
          onChunk: (chunk) => {
            spinReadme.stop();
            process.stdout.write(chunk);
          },
        });
        console.log();
        fs.writeFileSync(readmePath, readmeResult.content, "utf8");
        spinReadme.succeed("README.md regenerated");
        printQuality(readmeResult);
      } catch (err) {
        spinReadme.warn("README generation failed - keeping existing");
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

  const projectStack = (opts.ci || opts.docker || opts.hooks) ? analysis.getProjectStack() : undefined;
  const runtimePm = pkgMeta.packageManager ?? projectStack?.packageManager ?? "npm";
  const packageScripts = pkgMeta.scripts ?? {};

  if (opts.ci) {
    const ciContent = generateCiWorkflow({
      gitignorePreset: projectStack!.gitignorePreset,
      packageManager: runtimePm,
      hasTests: analysis.hasTests,
      files: analysis.allPaths,
      packageScripts,
    });
    writeFile(dir, ".github/workflows/ci.yml", ciContent);
    printSuccess("GitHub Actions CI workflow generated");
  }

  if (opts.docker) {
    const dockerOpts = {
      gitignorePreset: projectStack!.gitignorePreset,
      packageManager: runtimePm,
      files: analysis.allPaths,
      packageScripts,
      entryFileName: analysis.getReadmeContext().entryFileName,
    };
    writeFile(dir, "Dockerfile", generateDockerfile(dockerOpts));
    writeFile(dir, "docker-compose.yml", generateDockerCompose(dockerOpts));
    printSuccess("Dockerfile and docker-compose.yml generated");
  }

  if (opts.envExample) {
    const envContent = analysis.getEnvExample();
    if (envContent) {
      writeFile(dir, ".env.example", envContent);
      printSuccess(".env.example generated");
    } else {
      printInfo("No environment variables detected - skipping .env.example");
    }
  }

  if (opts.hooks) {
    const hooksResult = generateHooksConfig({
      gitignorePreset: projectStack!.gitignorePreset,
      packageManager: runtimePm,
      hasLint: analysis.hasLintConfig,
      hasFormat: analysis.hasFormatConfig,
      hasTypecheck: false,
    });
    if (hooksResult) {
      const applied = applyHooksConfig(dir, hooksResult);
      printSuccess("Pre-commit hooks generated");
      if (applied.packageJsonUpdated) {
        printSuccess("package.json updated with hook dependencies");
      }
      for (const warning of applied.warnings) {
        printWarning(warning);
      }
    } else {
      printWarning("Skipping hooks: this project does not have a Node-style package.json workflow.");
    }
  }

  if (opts.diff) {
    const git = simpleGit(dir);
    const status = await git.status();
    const modified = status.modified.length;
    const created = status.not_added.length + status.created.length;
    const deleted = status.deleted.length;

    console.log();
    printInfo("Changes summary:");
    if (modified > 0) console.log(`  ${c.dim("~")} ${modified} modified`);
    if (created > 0) console.log(`  ${c.dim("+")} ${created} new`);
    if (deleted > 0) console.log(`  ${c.dim("-")} ${deleted} deleted`);
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

  const gitFiles = filterFilesForGit(analysis.allPaths, cfg.gitIncludePatterns, cfg.gitExcludePatterns);

  let commitMessage = opts.message?.trim() || "";

  if (!commitMessage && opts.aiCommit && apiKey) {
    const spinAi = spinner("Generating commit message with AI...");
    try {
      const git = simpleGit(dir);
      await git.add(gitFiles.length > 0 ? gitFiles : ["-A"]);

      const stagedContext = await getStagedChangeContext(dir);
      const truncated = stagedContext.diff.length > 8000
        ? stagedContext.diff.slice(0, 8000) + "\n... (truncated)"
        : stagedContext.diff;

      const prompt = `You are a git commit message generator. Analyze the diff and write a single conventional commit message.
Rules:
- Format: type(scope): description
- Types: feat, fix, refactor, docs, style, test, chore, perf, ci, build
- Lowercase, imperative mood, no period, under 72 chars first line
- If substantial, add blank line then 2-3 bullet points max
- Output ONLY the commit message

Changed files (staged):
${stagedContext.stagedFiles.join("\n")}

Diff:
${truncated || "(no diff)"}`;

      commitMessage = await generateText({ provider, apiKey, prompt, maxTokens: 256 });
      commitMessage = commitMessage.trim().replace(/^```\n?/, "").replace(/\n?```$/, "").trim();
      spinAi.succeed(`AI commit (staged): ${c.accent(commitMessage.split("\n")[0]!)}`);
    } catch (err) {
      spinAi.warn(`AI commit message failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!commitMessage && opts.aiCommit && !apiKey) {
    printWarning("No API key - cannot generate AI commit message. Run `claude-ship config` to set one.");
  }

  if (!commitMessage) commitMessage = "chore: update via claude-ship";

  const spinCommit = spinner("Committing local changes...");
  const committed = await initAndCommit(dir, gitFiles, commitMessage);
  if (committed) {
    spinCommit.succeed("Committed local changes");
  } else {
    spinCommit.warn("No staged changes to commit");
  }

  const spinRepo = spinner(
    targetOrg ? `Creating repo under ${c.bold(targetOrg)}...` : "Resolving GitHub repository..."
  );
  const { repo, wasExisting } = await createGitHubRepo(
    token,
    projectName,
    description,
    opts.private,
    { org: targetOrg }
  );

  if (wasExisting) {
    spinRepo.succeed(`Using existing repo: ${c.path(repo.url)}`);
  } else {
    spinRepo.succeed(`Repo created: ${c.path(repo.url)}`);
  }

  const remoteUrl = useSSH ? repo.sshUrl : repo.cloneUrl;
  const spinPush = spinner(`Pushing to ${c.bold(targetBranch)}...`);
  try {
    await addRemoteAndPush(dir, remoteUrl, targetBranch);
    spinPush.succeed(`Pushed to ${repo.fullName}:${targetBranch}`);
  } catch (pushErr) {
    const msg = pushErr instanceof Error ? pushErr.message : String(pushErr);
    const isRejected =
      msg.includes("rejected") || msg.includes("fetch first") || msg.includes("non-fast-forward");
    if (!isRejected) throw pushErr;

    spinPush.warn("Push rejected - remote has commits not in local history.");
    const { action } = await inquirer.prompt<{ action: "force" | "abort" }>([{
      type: "list",
      name: "action",
      message: "What do you want to do?",
      choices: [
        {
          name: "Force push  - overwrite remote with local (remote commits will be lost)",
          value: "force",
        },
        {
          name: "Abort       - keep remote as-is",
          value: "abort",
        },
      ],
    }]);

    if (action === "abort") {
      printInfo("Aborted. Local files are committed but not pushed.");
      return;
    }

    const spinForce = spinner("Force pushing...");
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

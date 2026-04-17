import fs from "fs";
import path from "path";
import { resolveGitHubToken } from "../github.js";
import { initAndCommit } from "../git.js";
import { loadConfig, resolveDefaultProvider } from "../config.js";
import { printBanner, printSuccess, printError, printWarning, printInfo, spinner, c } from "../ui.js";
import { generateChangelog } from "../changelog.js";
import { validateProvider, resolveProviderWithKey } from "../cli-helpers.js";

export interface ReleaseOptions {
  dir: string;
  bump: "patch" | "minor" | "major";
  token?: string;
  provider?: string;
  apiKey?: string;
  draft: boolean;
}

function bumpVersion(version: string, bump: "patch" | "minor" | "major"): string {
  const clean = version.replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+/.test(clean)) {
    throw new Error(`Invalid semver version: "${version}" - expected format like 1.2.3`);
  }

  const parts = clean.split(".").slice(0, 3).map(Number);
  const [major = 0, minor = 0, patch = 0] = parts;
  switch (bump) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}

export async function runRelease(opts: ReleaseOptions) {
  await printBanner();
  const dir = fs.realpathSync(path.resolve(opts.dir));
  const cfg = loadConfig();

  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    throw new Error("No package.json found - release requires a package.json with a version field");
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: string; name?: string };
  const currentVersion = pkg.version ?? "0.0.0";
  const newVersion = bumpVersion(currentVersion, opts.bump);
  const tag = `v${newVersion}`;

  printInfo(`Version: ${c.dim(currentVersion)} -> ${c.bold(newVersion)} (${opts.bump})`);

  pkg.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  printSuccess(`package.json updated to ${newVersion}`);

  let provider = validateProvider(opts.provider ?? resolveDefaultProvider());
  const resolved = await resolveProviderWithKey(provider, opts.apiKey);
  const apiKey = resolved?.apiKey;
  if (resolved) provider = resolved.provider;

  let changelogContent = "";
  let wroteChangelog = false;
  if (apiKey) {
    const spinChangelog = spinner("Generating changelog...");
    try {
      changelogContent = await generateChangelog({
        dir,
        provider,
        apiKey,
        count: 50,
        onChunk: (chunk) => {
          spinChangelog.stop();
          process.stdout.write(chunk);
        },
      });
      console.log();
      spinChangelog.succeed("Changelog generated");

      const clPath = path.join(dir, "CHANGELOG.md");
      fs.writeFileSync(clPath, changelogContent, "utf8");
      wroteChangelog = true;
    } catch (err) {
      spinChangelog.warn("Changelog generation failed - continuing without");
      printWarning(err instanceof Error ? err.message : String(err));
    }
  }

  const spinCommit = spinner("Committing version bump...");
  const releaseFiles = ["package.json"];
  if (wroteChangelog) {
    releaseFiles.push("CHANGELOG.md");
  }

  const committed = await initAndCommit(dir, releaseFiles, `release: ${tag}`);
  if (!committed) {
    spinCommit.fail("Release commit failed");
    throw new Error("Release changes were not staged. Check package.json and CHANGELOG.md, then try again.");
  }
  spinCommit.succeed(`Committed: release ${tag}`);

  const { simpleGit } = await import("simple-git");
  const git = simpleGit(dir);
  await git.addTag(tag);
  printSuccess(`Tag created: ${tag}`);

  const token = await resolveGitHubToken(opts.token);
  const targetBranch = cfg.defaultBranch ?? "main";
  const spinPush = spinner("Pushing commit and tag...");
  try {
    await git.push("origin", targetBranch);
    await git.pushTags("origin");
    spinPush.succeed("Pushed to remote");
  } catch (err) {
    spinPush.warn("Push failed - you may need to push manually");
    printWarning(err instanceof Error ? err.message : String(err));
  }

  const { Octokit } = await import("@octokit/rest");
  const octokit = new Octokit({ auth: token });

  const remotes = await git.getRemotes(true);
  const origin = remotes.find((r) => r.name === "origin");
  if (!origin?.refs?.push) {
    printWarning("No origin remote found - skipping GitHub Release creation");
    return;
  }

  const remoteMatch = origin.refs.push.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (!remoteMatch) {
    printWarning("Could not parse GitHub owner/repo from remote - skipping Release");
    return;
  }

  const [, owner, repo] = remoteMatch;
  const spinRelease = spinner("Creating GitHub Release...");
  try {
    const release = await octokit.repos.createRelease({
      owner: owner!,
      repo: repo!,
      tag_name: tag,
      name: tag,
      body: changelogContent || `Release ${tag}`,
      draft: opts.draft,
    });
    spinRelease.succeed(`GitHub Release created: ${c.path(release.data.html_url)}`);
  } catch (err) {
    spinRelease.fail("Failed to create GitHub Release");
    printError(err instanceof Error ? err.message : String(err));
  }
}

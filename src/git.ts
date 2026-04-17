import { simpleGit, SimpleGit } from "simple-git";

export interface StagedChangeContext {
  stagedFiles: string[];
  diff: string;
  unstagedCount: number;
}

export async function getStagedChangeContext(dir: string): Promise<StagedChangeContext> {
  const git: SimpleGit = simpleGit(dir);
  const status = await git.status();
  const stagedSet = new Set(status.staged);
  const stagedFiles: string[] = [];
  const seen = new Set<string>();

  const addEntry = (entry: string) => {
    if (!seen.has(entry)) {
      seen.add(entry);
      stagedFiles.push(entry);
    }
  };

  for (const file of status.created) {
    if (stagedSet.has(file)) addEntry(`A  ${file}`);
  }

  for (const file of status.modified) {
    if (stagedSet.has(file)) addEntry(`M  ${file}`);
  }

  for (const file of status.deleted) {
    if (stagedSet.has(file)) addEntry(`D  ${file}`);
  }

  for (const rename of status.renamed) {
    addEntry(`R  ${rename.from} -> ${rename.to}`);
  }

  for (const file of status.staged) {
    addEntry(`M  ${file}`);
  }

  const unstagedModified = status.modified.filter((file) => !stagedSet.has(file)).length;
  const unstagedCount = unstagedModified + status.not_added.length;
  const diff = stagedFiles.length > 0
    ? await git.diff(["--staged"]).catch(() => "")
    : "";

  return { stagedFiles, diff, unstagedCount };
}

export async function initAndCommit(
  dir: string,
  files: string[],
  commitMessage = "chore: initial commit via claude-ship"
): Promise<boolean> {
  const git: SimpleGit = simpleGit(dir);

  const isRepo = await git.checkIsRepo().catch(() => false);
  if (!isRepo) {
    await git.init();
  }

  // Set a default identity if none is configured (avoids error on fresh machines)
  const config = await git.listConfig();
  if (!config.values[".git/config"]?.["user.email"]) {
    await git.addConfig("user.email", "claude-ship@users.noreply.github.com", false, "local");
    await git.addConfig("user.name", "claude-ship", false, "local");
  }

  await git.add(files.length > 0 ? files : ["-A"]);

  const stagedNames = await git.diff(["--cached", "--name-only"]).catch(() => "");
  if (stagedNames.trim()) {
    await git.commit(commitMessage);
    return true;
  }

  return false;
}

export async function addRemoteAndPush(
  dir: string,
  remoteUrl: string,
  branch = "main",
  force = false
): Promise<void> {
  const git: SimpleGit = simpleGit(dir);

  // Rename current branch to main if needed
  try {
    await git.branch(["-M", branch]);
  } catch {
    // Branch rename may fail if already named correctly
  }

  const remotes = await git.getRemotes();
  if (remotes.find((r) => r.name === "origin")) {
    await git.remote(["set-url", "origin", remoteUrl]);
  } else {
    await git.addRemote("origin", remoteUrl);
  }

  const pushArgs = force
    ? ["--force", "--set-upstream", "origin", branch]
    : ["--set-upstream", "origin", branch];
  await git.push(pushArgs);
}

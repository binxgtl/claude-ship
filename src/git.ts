import { simpleGit, SimpleGit } from "simple-git";

export async function initAndCommit(
  dir: string,
  files: string[],
  commitMessage = "🚀 Initial commit via claude-ship"
): Promise<void> {
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

  const status = await git.status();
  if (status.staged.length > 0 || status.created.length > 0 || status.modified.length > 0 || status.deleted.length > 0 || status.renamed.length > 0) {
    await git.commit(commitMessage);
  }
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

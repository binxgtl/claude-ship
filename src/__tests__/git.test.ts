import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { simpleGit } from "simple-git";
import { getStagedChangeContext, initAndCommit } from "../git.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "claudeship-git-test-"));
}

async function seedRepo(dir: string, files: Record<string, string>) {
  for (const [filePath, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, filePath)), { recursive: true });
    fs.writeFileSync(path.join(dir, filePath), content, "utf8");
  }
  await initAndCommit(dir, Object.keys(files), "chore: seed");
}

describe("git helpers", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("collects staged diff context without pulling in unstaged files", async () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);
    await seedRepo(dir, {
      "tracked.txt": "before\n",
      "unrelated.txt": "keep\n",
    });

    fs.writeFileSync(path.join(dir, "tracked.txt"), "before\nafter\n", "utf8");
    fs.writeFileSync(path.join(dir, "unrelated.txt"), "keep\nlocal only\n", "utf8");

    const git = simpleGit(dir);
    await git.add("tracked.txt");

    const context = await getStagedChangeContext(dir);

    expect(context.stagedFiles).toContain("M  tracked.txt");
    expect(context.stagedFiles.join("\n")).not.toContain("unrelated.txt");
    expect(context.diff).toContain("+after");
    expect(context.diff).not.toContain("local only");
    expect(context.unstagedCount).toBe(1);
  });

  it("commits only the requested files", async () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);
    await seedRepo(dir, {
      "package.json": JSON.stringify({ name: "demo", version: "1.0.0" }, null, 2) + "\n",
      "notes.txt": "base\n",
    });

    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "demo", version: "1.0.1" }, null, 2) + "\n",
      "utf8"
    );
    fs.writeFileSync(path.join(dir, "notes.txt"), "base\nunrelated\n", "utf8");

    const committed = await initAndCommit(dir, ["package.json"], "release: v1.0.1");
    expect(committed).toBe(true);

    const git = simpleGit(dir);
    const headFiles = (await git.raw(["show", "--pretty=format:", "--name-only", "HEAD"]))
      .split(/\r?\n/)
      .filter(Boolean);
    const status = await git.status();

    expect(headFiles).toEqual(["package.json"]);
    expect(status.modified).toContain("notes.txt");
    expect(status.modified).not.toContain("package.json");
  });
});

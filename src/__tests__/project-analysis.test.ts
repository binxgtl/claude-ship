import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createParsedProjectAnalysis, createProjectAnalysis } from "../project-analysis.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "claudeship-analysis-test-"));
}

describe("project analysis cache", () => {
  let tmpDir: string;

  afterEach(() => {
    vi.restoreAllMocks();
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reuses cached file reads across derived analyses", () => {
    tmpDir = makeTmpDir();
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "packages", "tool"), { recursive: true });

    const rootPkgPath = path.join(tmpDir, "package.json");
    const readmePath = path.join(tmpDir, "README.md");
    const entryPath = path.join(tmpDir, "src", "index.ts");

    fs.writeFileSync(
      rootPkgPath,
      JSON.stringify({
        name: "demo-app",
        description: "cached analysis demo",
        workspaces: ["packages/*"],
      }, null, 2) + "\n",
      "utf8"
    );
    fs.writeFileSync(readmePath, "# Demo\n", "utf8");
    fs.writeFileSync(
      entryPath,
      'console.log(process.env.OPENAI_API_KEY);\n',
      "utf8"
    );
    fs.writeFileSync(
      path.join(tmpDir, "packages", "tool", "package.json"),
      JSON.stringify({ name: "@demo/tool", version: "1.0.0" }, null, 2) + "\n",
      "utf8"
    );

    const spy = vi.spyOn(fs, "readFileSync");
    const analysis = createProjectAnalysis(tmpDir);

    expect(analysis.getPackageMetadata().name).toBe("demo-app");
    expect(analysis.getPackageMetadata().description).toBe("cached analysis demo");
    expect(analysis.getExistingReadme()).toBe("# Demo\n");
    expect(analysis.getProjectStack().packageManager).toBe("npm");
    expect(analysis.getReadmeStack().packageManager).toBe("npm");
    expect(analysis.getReadmeContext().workspacePackages).toHaveLength(1);
    expect(analysis.getReadmeContext().workspacePackages[0]?.name).toBe("@demo/tool");
    expect(analysis.getEnvExample()).toBe("OPENAI_API_KEY=\n");

    analysis.getPackageMetadata();
    analysis.getExistingReadme();
    analysis.getReadmeFiles();
    analysis.getReadmeContext();
    analysis.getEnvExample();

    const rootPkgReads = spy.mock.calls.filter(([filePath]) => filePath === rootPkgPath);
    const readmeReads = spy.mock.calls.filter(([filePath]) => filePath === readmePath);
    const entryReads = spy.mock.calls.filter(([filePath]) => filePath === entryPath);

    expect(rootPkgReads).toHaveLength(1);
    expect(readmeReads).toHaveLength(1);
    expect(entryReads).toHaveLength(1);
  });

  it("analyzes parsed files without filesystem reads", () => {
    const spy = vi.spyOn(fs, "readFileSync");
    const analysis = createParsedProjectAnalysis([
      {
        path: "package.json",
        content: JSON.stringify({
          name: "memory-app",
          description: "from parsed files",
          scripts: {
            lint: "eslint .",
          },
        }, null, 2),
      },
      {
        path: "README.md",
        content: "# Existing\n",
      },
      {
        path: "src/index.ts",
        content: 'console.log(process.env.GITHUB_TOKEN);\n',
      },
    ]);

    expect(analysis.getPackageMetadata().name).toBe("memory-app");
    expect(analysis.getExistingReadme()).toBe("# Existing\n");
    expect(analysis.getReadmePaths()).toContain("src/index.ts");
    expect(analysis.getEnvExample()).toBe("GITHUB_TOKEN=\n");
    expect(analysis.hasLintConfig).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});

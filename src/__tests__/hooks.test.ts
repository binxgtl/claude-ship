import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { applyHooksConfig, generateHooksConfig } from "../hooks-generator.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "claudeship-hooks-test-"));
}

describe("hooks generator", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("writes hook files and merges package.json metadata", () => {
    tmpDir = makeTmpDir();
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        name: "demo",
        scripts: {
          prepare: "custom-prepare",
        },
        dependencies: {
          husky: "^9.0.0",
        },
        devDependencies: {
          typescript: "^5.0.0",
        },
      }, null, 2) + "\n",
      "utf8"
    );

    const hooks = generateHooksConfig({
      gitignorePreset: "node",
      packageManager: "npm",
      hasLint: true,
      hasFormat: true,
      hasTypecheck: false,
    });

    expect(hooks).not.toBeNull();
    const result = applyHooksConfig(tmpDir, hooks!);
    const pkg = JSON.parse(fs.readFileSync(path.join(tmpDir, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(result.packageJsonUpdated).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.writtenFiles).toContain(".husky/pre-commit");
    expect(result.writtenFiles).toContain(".lintstagedrc.json");
    expect(fs.existsSync(path.join(tmpDir, ".husky", "pre-commit"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".lintstagedrc.json"))).toBe(true);
    expect(pkg.scripts.prepare).toBe("custom-prepare && husky");
    expect(pkg.dependencies.husky).toBe("^9.0.0");
    expect(pkg.devDependencies["lint-staged"]).toBe("^15.0.0");
    expect(pkg.devDependencies.typescript).toBe("^5.0.0");
  });
});

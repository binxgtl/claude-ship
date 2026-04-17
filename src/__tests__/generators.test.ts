import { describe, expect, it } from "vitest";
import { generateCiWorkflow } from "../ci-generator.js";
import { generateDockerCompose, generateDockerfile } from "../docker-generator.js";

describe("CI generator hardening", () => {
  it("uses npm install without a lockfile and skips missing scripts", () => {
    const workflow = generateCiWorkflow({
      gitignorePreset: "node",
      packageManager: "npm",
      hasTests: true,
      files: ["package.json", "src/index.ts"],
      packageScripts: {
        lint: "eslint .",
      },
    });

    expect(workflow).toContain("run: npm install");
    expect(workflow).toContain("name: Lint");
    expect(workflow).not.toContain("npm ci");
    expect(workflow).not.toContain("name: Build");
    expect(workflow).not.toContain("name: Test");
    expect(workflow).not.toContain("cache-dependency-path");
  });

  it("installs from pyproject when requirements.txt is absent", () => {
    const workflow = generateCiWorkflow({
      gitignorePreset: "python",
      packageManager: "pip",
      hasTests: false,
      files: ["pyproject.toml", "app/main.py"],
    });

    expect(workflow).toContain("pip install .");
    expect(workflow).not.toContain("pip install -r requirements.txt");
  });
});

describe("Docker generator hardening", () => {
  it("avoids lockfile/build assumptions for vite projects", () => {
    const options = {
      gitignorePreset: "node" as const,
      packageManager: "npm",
      files: ["package.json", "vite.config.ts", "src/main.ts"],
      packageScripts: {
        dev: "vite",
      },
      entryFileName: "src/main.ts",
    };

    const dockerfile = generateDockerfile(options);
    const compose = generateDockerCompose(options);

    expect(dockerfile).toContain("COPY package.json ./");
    expect(dockerfile).not.toContain("package-lock.json");
    expect(dockerfile).not.toContain("RUN npm run build");
    expect(dockerfile).toContain('CMD ["npm","run","dev","--","--host","0.0.0.0"]');
    expect(compose).toContain('${PORT:-5173}:5173');
    expect(compose).not.toContain("env_file");
  });

  it("omits language lockfiles that are not present", () => {
    const goDocker = generateDockerfile({
      gitignorePreset: "go",
      packageManager: "go",
      files: ["go.mod", "main.go"],
    });
    const rustDocker = generateDockerfile({
      gitignorePreset: "rust",
      packageManager: "cargo",
      files: ["Cargo.toml", "src/main.rs"],
    });

    expect(goDocker).toContain("COPY go.mod ./");
    expect(goDocker).not.toContain("go.sum");
    expect(rustDocker).toContain("COPY Cargo.toml ./");
    expect(rustDocker).not.toContain("Cargo.lock ./");
  });
});

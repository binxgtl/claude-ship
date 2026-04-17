import { describe, expect, it } from "vitest";
import { extractReadmeContext } from "../scaffold.js";
import { buildInstallSection } from "../readme.js";

const INSTALL_SECTION_RE = /^#{2,3}\s.*(install|getting started|bắt đầu|cài đặt)/im;
const GIT_CLONE_RE = /\bgit clone\b/i;
const CLI_INSTALL_RE = /\bnpx\b|\bnpm install\b|\byarn (global )?add\b|\byarn dlx\b|\bpnpm (add|install|dlx)\b/i;

describe("install block validator patterns", () => {
  it("detects a Getting Started section", () => {
    const text = "## 🚀 Getting Started\n\n```bash\ngit clone ...\n```";
    expect(INSTALL_SECTION_RE.test(text)).toBe(true);
  });

  it("detects Installation section (Vietnamese)", () => {
    const text = "## 🚀 Cài đặt\n\n```bash\ngit clone ...\n```";
    expect(INSTALL_SECTION_RE.test(text)).toBe(true);
  });

  it("flags missing git clone in non-CLI install section", () => {
    const text = "## Getting Started\n\n```bash\ncd my-project\nmake build\n```";
    expect(INSTALL_SECTION_RE.test(text)).toBe(true);
    expect(GIT_CLONE_RE.test(text)).toBe(false);
  });

  it("passes when git clone is present", () => {
    const text = "## Getting Started\n\n```bash\ngit clone https://github.com/x/y\ncd y\nmake\n```";
    expect(GIT_CLONE_RE.test(text)).toBe(true);
  });

  it("passes CLI project with package-manager commands", () => {
    const text = "## Getting Started\n\n```bash\npnpm dlx my-tool\n```";
    expect(CLI_INSTALL_RE.test(text)).toBe(true);
  });
});

describe("README install section hardening", () => {
  it("uses pnpm commands for CLI contributor flow", () => {
    const context = extractReadmeContext([
      {
        path: "package.json",
        content: JSON.stringify({
          name: "my-tool",
          packageManager: "pnpm@9.0.0",
          bin: {
            "my-tool": "dist/index.js",
          },
          scripts: {
            build: "tsc",
          },
        }, null, 2),
      },
      { path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'\n" },
      { path: "src/index.ts", content: "console.log('hello');\n" },
    ]);

    const section = buildInstallSection(context, "my-tool", false, "acme");

    expect(section).toContain("pnpm dlx my-tool");
    expect(section).toContain("pnpm add -g my-tool");
    expect(section).toContain("pnpm install");
    expect(section).toContain("pnpm run build");
    expect(section).toContain("npx my-tool --help");
  });

  it("uses yarn install and dev commands for non-CLI projects", () => {
    const context = extractReadmeContext([
      {
        path: "package.json",
        content: JSON.stringify({
          name: "web-app",
          packageManager: "yarn@4.0.0",
          scripts: {
            dev: "vite",
          },
        }, null, 2),
      },
      { path: "yarn.lock", content: "__metadata:\n  version: 4\n" },
      { path: "src/main.ts", content: "console.log('hello');\n" },
    ]);

    const section = buildInstallSection(context, "web-app", false, "acme");

    expect(section).toContain("yarn install");
    expect(section).toContain("yarn dev");
    expect(section).toContain("git clone https://github.com/acme/web-app.git");
  });
});

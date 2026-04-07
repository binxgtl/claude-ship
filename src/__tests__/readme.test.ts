import { describe, it, expect } from "vitest";

// Test the sanitizer logic directly by importing internals via a thin re-export.
// Since sanitizeOutput is not exported, we test its effect through observable
// score/issue behaviour by calling the module-level helpers indirectly.
// For now we unit-test the regex patterns used inside sanitizeOutput.

const INSTALL_SECTION_RE = /^#{2,3}\s.*(install|getting started|bắt đầu|cài đặt)/im;
const GIT_CLONE_RE = /\bgit clone\b/i;
const NPX_RE = /\bnpx\b|\bnpm install\b/i;

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

  it("passes CLI project with npx instead of git clone", () => {
    const text = "## Getting Started\n\n```bash\nnpx my-tool --help\n```";
    expect(NPX_RE.test(text)).toBe(true);
  });
});

import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { writeFiles, writeLicenseFile } from "../scaffold.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "claudeship-test-"));
}

describe("writeFiles — path boundary", () => {
  let tmpDir: string;
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("writes normal files inside outputDir", () => {
    tmpDir = makeTmpDir();
    writeFiles(tmpDir, [{ path: "src/index.ts", content: "export {}", language: "ts" }]);
    expect(fs.existsSync(path.join(tmpDir, "src/index.ts"))).toBe(true);
  });

  it("throws on path that would escape outputDir", () => {
    tmpDir = makeTmpDir();
    expect(() =>
      writeFiles(tmpDir, [{ path: "../escape.ts", content: "bad", language: "ts" }])
    ).toThrow(/unsafe path/i);
  });
});

describe("writeLicenseFile — no overwrite", () => {
  let tmpDir: string;
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("writes LICENSE when none exists", () => {
    tmpDir = makeTmpDir();
    writeLicenseFile(tmpDir, "MIT", "Test Author");
    expect(fs.existsSync(path.join(tmpDir, "LICENSE"))).toBe(true);
  });

  it("does not overwrite an existing LICENSE", () => {
    tmpDir = makeTmpDir();
    const dest = path.join(tmpDir, "LICENSE");
    fs.writeFileSync(dest, "CUSTOM LICENSE", "utf8");
    writeLicenseFile(tmpDir, "MIT", "Test Author");
    expect(fs.readFileSync(dest, "utf8")).toBe("CUSTOM LICENSE");
  });

  it("does not create LICENSE when LICENSE.txt already exists", () => {
    tmpDir = makeTmpDir();
    fs.writeFileSync(path.join(tmpDir, "LICENSE.txt"), "CUSTOM LICENSE", "utf8");
    writeLicenseFile(tmpDir, "MIT", "Test Author");
    expect(fs.existsSync(path.join(tmpDir, "LICENSE"))).toBe(false);
  });
});

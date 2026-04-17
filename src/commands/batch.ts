import fs from "fs";
import path from "path";
import { parseClaudeResponse } from "../parser.js";
import { getGitignoreContent } from "../detector.js";
import { initAndCommit } from "../git.js";
import {
  writeFiles, writeFile, getAllFilePaths,
} from "../scaffold.js";
import { printBanner, printSuccess, printError, printWarning, printInfo, c } from "../ui.js";
import { generateCiWorkflow } from "../ci-generator.js";
import { generateDockerfile, generateDockerCompose } from "../docker-generator.js";
import { createParsedProjectAnalysis } from "../project-analysis.js";

export interface BatchOptions {
  token?: string;
  private: boolean;
  push: boolean;
  provider?: string;
  apiKey?: string;
  out?: string;
  ci: boolean;
  docker: boolean;
}

export async function runBatch(inputDir: string, opts: BatchOptions) {
  await printBanner();

  const resolved = path.resolve(inputDir);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Not a directory: ${resolved}`);
  }

  const files = fs.readdirSync(resolved)
    .filter((f) => /\.(txt|md)$/i.test(f))
    .sort();

  if (files.length === 0) {
    throw new Error(`No .txt or .md files found in ${resolved}`);
  }

  printInfo(`Found ${files.length} response file(s) to process`);
  console.log();

  let succeeded = 0;
  let failed = 0;

  for (const file of files) {
    const baseName = file.replace(/\.(txt|md)$/i, "");
    printInfo(`Processing: ${c.bold(file)}`);

    try {
      const content = fs.readFileSync(path.join(resolved, file), "utf8");
      const { files: parsedFiles } = parseClaudeResponse(content);

      if (parsedFiles.length === 0) {
        printWarning(`  No code blocks found in ${file} — skipping`);
        failed++;
        continue;
      }

      const outBase = opts.out ? path.resolve(opts.out) : process.cwd();
      const outputDir = path.join(outBase, baseName);
      fs.mkdirSync(outputDir, { recursive: true });

      writeFiles(outputDir, parsedFiles);

      const analysis = createParsedProjectAnalysis(parsedFiles);
      const stack = analysis.getProjectStack();
      const pkgMeta = analysis.getPackageMetadata();
      const runtimePm = pkgMeta.packageManager ?? stack.packageManager;
      const packageScripts = pkgMeta.scripts ?? {};
      const readmeContext = opts.docker ? analysis.getReadmeContext() : undefined;
      writeFile(outputDir, ".gitignore", getGitignoreContent(stack.gitignorePreset));

      if (opts.ci) {
        const ciContent = generateCiWorkflow({
          gitignorePreset: stack.gitignorePreset,
          packageManager: runtimePm,
          hasTests: analysis.hasTests,
          files: analysis.allPaths,
          packageScripts,
        });
        writeFile(outputDir, ".github/workflows/ci.yml", ciContent);
      }

      if (opts.docker) {
        const dockerOpts = {
          gitignorePreset: stack.gitignorePreset,
          packageManager: runtimePm,
          files: analysis.allPaths,
          packageScripts,
          entryFileName: readmeContext?.entryFileName,
        };
        writeFile(outputDir, "Dockerfile", generateDockerfile(dockerOpts));
        writeFile(outputDir, "docker-compose.yml", generateDockerCompose(dockerOpts));
      }

      const allGitFiles = getAllFilePaths(outputDir);
      await initAndCommit(outputDir, allGitFiles);

      printSuccess(`  ${baseName}: ${parsedFiles.length} files → ${c.path(outputDir)}`);
      succeeded++;
    } catch (err) {
      printError(`  ${baseName}: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  console.log();
  printInfo(`Batch complete: ${c.bold(String(succeeded))} succeeded, ${failed > 0 ? c.error(String(failed)) : "0"} failed`);
}

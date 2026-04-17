import inquirer from "inquirer";
import fs from "fs";
import { generateReadme } from "../readme.js";
import { loadConfig } from "../config.js";
import { providerLabel, providerEnvVar } from "../providers.js";
import { printSuccess, printInfo, spinner, c } from "../ui.js";
import {
  validateProvider,
  resolveFallback,
  printQuality,
  resolveMaxTokens,
  resolveDetail,
  resolveStyle,
  resolveProviderWithKey,
} from "../cli-helpers.js";
import { createProjectAnalysis } from "../project-analysis.js";

export interface ReadmeRunOptions {
  vi: boolean;
  dir: string;
  provider: string;
  apiKey?: string;
  detail?: string;
  maxTokens?: string;
  style?: string;
  preview: boolean;
}

export async function runReadme(opts: ReadmeRunOptions) {
  let provider = validateProvider(opts.provider);
  const readmeCfg = loadConfig();
  const detail = resolveDetail(opts.detail, readmeCfg);
  const dir = fs.realpathSync(opts.dir);
  const analysis = createProjectAnalysis(dir, {
    aiExcludePatterns: readmeCfg.aiExcludePatterns,
    readmeExcludePatterns: readmeCfg.readmeExcludePatterns,
  });

  const resolved = await resolveProviderWithKey(provider, opts.apiKey);
  if (!resolved) {
    throw new Error(
      `API key required for README generation.\n` +
        `Set the ${providerEnvVar(provider)} environment variable, or run:\n` +
        "  claude-ship config"
    );
  }
  provider = resolved.provider;
  const apiKey = resolved.apiKey;

  const isVi = opts.vi || (readmeCfg.defaultVi ?? false);
  const readmeFiles = analysis.getReadmePaths();
  const stack = analysis.getReadmeStack();
  const context = analysis.getReadmeContext();
  const pkg = analysis.getPackageMetadata();

  const projectName = pkg.name ?? dir.split(/[/\\]/).pop() ?? "my-project";
  const description = pkg.description ?? "";

  const label = providerLabel(provider);
  const fallback = resolveFallback(provider, readmeCfg);
  const outPath = `${dir}/README.md`;
  const existingReadme = analysis.getExistingReadme();
  const spinReadme = spinner(`Generating ${isVi ? "Vietnamese " : ""}README via ${label}...`);
  const readmeResult = await generateReadme({
    projectName,
    description,
    stack,
    files: readmeFiles,
    context,
    vietnamese: isVi,
    detail,
    style: resolveStyle(opts.style, readmeCfg),
    license: readmeCfg.defaultLicense,
    author: readmeCfg.projectAuthor ?? readmeCfg.githubUsername,
    sections: readmeCfg.readmeSections,
    githubUsername: readmeCfg.githubUsername,
    maxTokens: resolveMaxTokens(opts.maxTokens, readmeCfg.maxReadmeTokens),
    provider,
    apiKey,
    fallbackProvider: fallback?.provider,
    fallbackApiKey: fallback?.apiKey,
    existingReadme,
    onChunk: (chunk) => {
      spinReadme.stop();
      process.stdout.write(chunk);
    },
  });
  console.log();
  spinReadme.succeed(
    `README generated via ${readmeResult.usedFallback ? providerLabel(fallback!.provider) : label}`
  );
  printQuality(readmeResult);

  if (opts.preview) {
    console.log();
    console.log(c.dim("-".repeat(60)));
    console.log(readmeResult.content);
    console.log(c.dim("-".repeat(60)));
    console.log();

    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
      type: "confirm",
      name: "confirm",
      message: "Write this README to disk?",
      default: true,
    }]);

    if (!confirm) {
      printInfo("Aborted - README not written.");
      return;
    }
  }

  fs.writeFileSync(outPath, readmeResult.content, "utf8");
  printSuccess(`README written to ${c.path(outPath)}`);
}

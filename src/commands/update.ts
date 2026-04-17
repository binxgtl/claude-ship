import fs from "fs";
import path from "path";
import { generateReadme } from "../readme.js";
import { loadConfig, resolveDefaultProvider } from "../config.js";
import { providerLabel } from "../providers.js";
import { printBanner, printSuccess, printWarning, printInfo, spinner, c } from "../ui.js";
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

export interface UpdateRunOptions {
  dir: string;
  provider?: string;
  apiKey?: string;
  vi: boolean;
  detail?: string;
  style?: string;
  maxTokens?: string;
}

export async function runUpdate(opts: UpdateRunOptions) {
  await printBanner();
  const dir = fs.realpathSync(path.resolve(opts.dir));
  const cfg = loadConfig();
  let provider = validateProvider(opts.provider ?? resolveDefaultProvider());
  const analysis = createProjectAnalysis(dir, {
    aiExcludePatterns: cfg.aiExcludePatterns,
    readmeExcludePatterns: cfg.readmeExcludePatterns,
  });

  const stack = analysis.getReadmeStack();
  const context = analysis.getReadmeContext();
  const workspaces = context.workspacePackages;

  printInfo(`Detected stack: ${c.bold(stack.name)}`);
  if (workspaces.length > 0) {
    printInfo(`Monorepo: ${workspaces.length} workspace packages detected`);
    for (const ws of workspaces) {
      console.log(`  ${c.dim("*")} ${ws.name} (${ws.path})`);
    }
  }

  const pkg = analysis.getPackageMetadata();
  const projectName = pkg.name ?? dir.split(/[/\\]/).pop() ?? "my-project";
  const description = pkg.description ?? "";

  const resolved = await resolveProviderWithKey(provider, opts.apiKey);
  if (!resolved) {
    printWarning("No API key - can only show detection results. Run `claude-ship config` to enable AI generation.");
    return;
  }
  provider = resolved.provider;
  const apiKey = resolved.apiKey;

  const isVi = opts.vi || (cfg.defaultVi ?? false);
  const detail = resolveDetail(opts.detail, cfg);
  const fallback = resolveFallback(provider, cfg);
  const readmePath = path.join(dir, "README.md");
  const existingReadme = analysis.getExistingReadme();

  const label = providerLabel(provider);
  const spinReadme = spinner(`Regenerating README via ${label}...`);
  const readmeResult = await generateReadme({
    projectName,
    description,
    stack,
    files: analysis.getReadmePaths(),
    context,
    vietnamese: isVi,
    detail,
    style: resolveStyle(opts.style, cfg),
    license: cfg.defaultLicense,
    author: cfg.projectAuthor ?? cfg.githubUsername,
    sections: cfg.readmeSections,
    githubUsername: cfg.githubUsername,
    maxTokens: resolveMaxTokens(opts.maxTokens, cfg.maxReadmeTokens),
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
    `README updated via ${readmeResult.usedFallback ? providerLabel(fallback!.provider) : label}`
  );
  printQuality(readmeResult);

  fs.writeFileSync(readmePath, readmeResult.content, "utf8");
  printSuccess(`README written to ${c.path(readmePath)}`);
}

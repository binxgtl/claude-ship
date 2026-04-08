import fs from "fs";
import path from "path";
import { detectTechStack } from "../detector.js";
import { generateReadme } from "../readme.js";
import {
  getAllFilePaths, extractReadmeContext,
  filterFilesForAI, filterFilesForReadme, detectWorkspacesFromDir,
} from "../scaffold.js";
import { loadConfig, resolveDefaultProvider } from "../config.js";
import { providerLabel } from "../providers.js";
import { printBanner, printSuccess, printWarning, printInfo, spinner, c } from "../ui.js";
import {
  validateProvider, resolveFallback, printQuality,
  resolveMaxTokens, resolveDetail, resolveStyle, resolveProviderWithKey,
} from "../cli-helpers.js";

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

  const allPaths = getAllFilePaths(dir);
  const aiFiltered = filterFilesForAI(allPaths, cfg.aiExcludePatterns);
  const readmeFiltered = filterFilesForReadme(aiFiltered, cfg.readmeExcludePatterns);

  const parsedFiles = readmeFiltered.map((f) => {
    let content = "";
    try { content = fs.readFileSync(path.join(dir, f), "utf8"); } catch { /* skip */ }
    return { path: f, content, language: undefined };
  });

  const stack = detectTechStack(parsedFiles);
  const context = extractReadmeContext(parsedFiles);
  const workspaces = detectWorkspacesFromDir(dir);

  printInfo(`Detected stack: ${c.bold(stack.name)}`);
  if (workspaces.length > 0) {
    printInfo(`Monorepo: ${workspaces.length} workspace packages detected`);
    for (const ws of workspaces) {
      console.log(`  ${c.dim("•")} ${ws.name} (${ws.path})`);
    }
  }

  let projectName = dir.split(/[/\\]/).pop() ?? "my-project";
  let description = "";
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
      name?: string; description?: string;
    };
    if (pkg.name) projectName = pkg.name;
    if (pkg.description) description = pkg.description;
  } catch { /* no package.json */ }

  const resolved = await resolveProviderWithKey(provider, opts.apiKey);
  if (!resolved) {
    printWarning("No API key — can only show detection results. Run `claude-ship config` to enable AI generation.");
    return;
  }
  provider = resolved.provider;
  const apiKey = resolved.apiKey;

  const isVi = opts.vi || (cfg.defaultVi ?? false);
  const detail = resolveDetail(opts.detail, cfg);
  const fallback = resolveFallback(provider, cfg);
  const readmePath = path.join(dir, "README.md");
  const existingReadme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, "utf8") : undefined;

  const label = providerLabel(provider);
  const spinReadme = spinner(`Regenerating README via ${label}…`);
  const readmeResult = await generateReadme({
    projectName,
    description,
    stack,
    files: readmeFiltered,
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
    onChunk: (chunk) => { spinReadme.stop(); process.stdout.write(chunk); },
  });

  console.log();
  spinReadme.succeed(`README updated via ${readmeResult.usedFallback ? providerLabel(fallback!.provider) : label}`);
  printQuality(readmeResult);

  fs.writeFileSync(readmePath, readmeResult.content, "utf8");
  printSuccess(`README written to ${c.path(readmePath)}`);
}

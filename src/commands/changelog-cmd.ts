import fs from "fs";
import path from "path";
import { resolveDefaultProvider } from "../config.js";
import { providerLabel, providerEnvVar } from "../providers.js";
import { printBanner, printSuccess, spinner, c } from "../ui.js";
import { generateChangelog } from "../changelog.js";
import { validateProvider, resolveProviderWithKey } from "../cli-helpers.js";

export interface ChangelogRunOptions {
  dir: string;
  provider?: string;
  apiKey?: string;
  count?: string;
}

export async function runChangelog(opts: ChangelogRunOptions) {
  await printBanner();
  const dir = fs.realpathSync(path.resolve(opts.dir));
  let provider = validateProvider(opts.provider ?? resolveDefaultProvider());
  const resolved = await resolveProviderWithKey(provider, opts.apiKey);
  if (!resolved) {
    throw new Error(
      `API key required for changelog generation.\n` +
        `Set ${providerEnvVar(provider)} or run: claude-ship config`
    );
  }
  provider = resolved.provider;
  const apiKey = resolved.apiKey;

  const count = opts.count ? parseInt(opts.count, 10) : 100;
  const label = providerLabel(provider);
  const spinLog = spinner(`Generating changelog from git history via ${label}…`);

  const content = await generateChangelog({
    dir,
    provider,
    apiKey,
    count,
    onChunk: (chunk) => { spinLog.stop(); process.stdout.write(chunk); },
  });

  console.log();
  spinLog.succeed("Changelog generated");

  const outPath = path.join(dir, "CHANGELOG.md");
  fs.writeFileSync(outPath, content, "utf8");
  printSuccess(`Written to ${c.path(outPath)}`);
}

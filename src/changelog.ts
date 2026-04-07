import { simpleGit } from "simple-git";
import { generateText } from "./providers.js";
import { Provider } from "./types.js";

export interface ChangelogOptions {
  dir: string;
  provider: Provider;
  apiKey: string;
  count?: number;
  onChunk?: (chunk: string) => void;
}

interface CommitInfo {
  hash: string;
  date: string;
  message: string;
  author: string;
}

export async function generateChangelog(opts: ChangelogOptions): Promise<string> {
  const git = simpleGit(opts.dir);

  const log = await git.log({ maxCount: opts.count ?? 100 });
  if (log.all.length === 0) {
    throw new Error("No git history found. Make sure you are in a git repository with at least one commit.");
  }

  const commits: CommitInfo[] = log.all.map((c) => ({
    hash: c.hash.slice(0, 7),
    date: c.date.split("T")[0] ?? c.date,
    message: c.message,
    author: c.author_name,
  }));

  const tags = await git.tags();
  const tagList = tags.all.length > 0
    ? `\nGit tags (versions): ${tags.all.join(", ")}`
    : "";

  const commitBlock = commits
    .map((c) => `${c.hash} ${c.date} ${c.author}: ${c.message}`)
    .join("\n");

  const prompt = `You are a technical writer generating a CHANGELOG.md from git commit history.

## Rules
1. Output ONLY raw Markdown. No explanations before or after.
2. Group commits by version tag if available, otherwise group by date (month).
3. Categorize each change as: Added, Changed, Fixed, Removed, or Security.
4. Write concise, user-facing descriptions — not raw commit messages.
5. Skip merge commits and bot commits.
6. Use the Keep a Changelog format (https://keepachangelog.com).
7. Start with "# Changelog" as the H1 heading.
${tagList}

## Git commit history (newest first)
${commitBlock}`;

  const result = await generateText({
    provider: opts.provider,
    apiKey: opts.apiKey,
    prompt,
    maxTokens: 4000,
    onChunk: opts.onChunk,
  });

  return result.trim();
}

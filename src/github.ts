import { Octokit } from "@octokit/rest";
import { execSync } from "child_process";
import { loadConfig } from "./config.js";
import { GitHubRepo } from "./types.js";

// ─── Token resolution ─────────────────────────────────────────────────────────

function getTokenFromGhCli(): string | null {
  try {
    const token = execSync("gh auth token", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return token || null;
  } catch {
    return null;
  }
}

/**
 * Resolve a GitHub token with priority:
 *   --token flag → gh CLI → GITHUB_TOKEN env → saved config
 */
export async function resolveGitHubToken(providedToken?: string): Promise<string> {
  if (providedToken) return providedToken;

  const ghToken = getTokenFromGhCli();
  if (ghToken) return ghToken;

  const envToken = process.env["GITHUB_TOKEN"] ?? process.env["GH_TOKEN"];
  if (envToken) return envToken;

  const savedToken = loadConfig().githubToken;
  if (savedToken) return savedToken;

  throw new Error(
    "No GitHub token found.\n" +
      "Options:\n" +
      "  • Run: claude-ship config  (save a token or connect via OAuth)\n" +
      "  • Run: gh auth login\n" +
      "  • Set the GITHUB_TOKEN environment variable\n" +
      "  • Pass --token <token>"
  );
}

// ─── Token validation ─────────────────────────────────────────────────────────

export interface GitHubTokenInfo {
  username: string;
  scopes: string;
  name: string;
  avatarUrl: string;
}

export async function validateGitHubToken(token: string): Promise<GitHubTokenInfo> {
  const octokit = new Octokit({ auth: token });

  // Fetch user + scopes in parallel
  const [userRes, scopeRes] = await Promise.all([
    octokit.users.getAuthenticated(),
    octokit.request("HEAD /"),
  ]);

  const scopes =
    (scopeRes.headers as Record<string, string | undefined>)["x-oauth-scopes"] ?? "";

  return {
    username: userRes.data.login,
    name: userRes.data.name ?? userRes.data.login,
    avatarUrl: userRes.data.avatar_url,
    scopes,
  };
}

// ─── Repo operations ──────────────────────────────────────────────────────────

export type ExistingRepoAction = "push" | "abort";

export interface CreateRepoOptions {
  org?: string;           // create under this org instead of personal account
  existingAction?: ExistingRepoAction; // what to do if repo already exists
}

export interface CreateRepoResult {
  repo: GitHubRepo;
  /** true when the repo already existed before this call */
  wasExisting: boolean;
}

export async function createGitHubRepo(
  token: string,
  name: string,
  description: string,
  isPrivate: boolean,
  options: CreateRepoOptions = {}
): Promise<CreateRepoResult> {
  const octokit = new Octokit({ auth: token });

  const { data: user } = await octokit.users.getAuthenticated();
  const owner = options.org ?? user.login;

  function toRepo(data: {
    html_url: string;
    clone_url: string;
    ssh_url: string;
    name: string;
    full_name: string;
  }): GitHubRepo {
    return {
      url: data.html_url,
      cloneUrl: data.clone_url,
      sshUrl: data.ssh_url,
      name: data.name,
      fullName: data.full_name,
    };
  }

  // Check if repo already exists
  try {
    const { data: existing } = await octokit.repos.get({ owner, repo: name });
    return { repo: toRepo(existing), wasExisting: true };
  } catch (err: unknown) {
    if ((err as { status?: number }).status !== 404) throw err;
  }

  const data = options.org
    ? (await octokit.repos.createInOrg({ org: options.org, name, description, private: isPrivate, auto_init: false })).data
    : (await octokit.repos.createForAuthenticatedUser({ name, description, private: isPrivate, auto_init: false })).data;

  return { repo: toRepo(data), wasExisting: false };
}

/** List orgs the authenticated user is a member of. */
export async function listUserOrgs(token: string): Promise<string[]> {
  const octokit = new Octokit({ auth: token });
  const { data } = await octokit.orgs.listForAuthenticatedUser({ per_page: 50 });
  return data.map((o) => o.login);
}

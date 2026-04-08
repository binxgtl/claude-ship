import crypto from "crypto";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { printSuccess, printError, printInfo, spinner, c } from "./ui.js";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_BASE = "https://auth.openai.com";
const AUTHORIZE_URL = `${AUTH_BASE}/oauth/authorize`;
const TOKEN_URL = `${AUTH_BASE}/oauth/token`;
const SCOPES = "openid profile email offline_access api.connectors.read api.connectors.invoke";
const CALLBACK_PORT = 1455;
const CALLBACK_PATH = "/auth/callback";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function resolveAuthDir(): string {
  return path.join(os.homedir(), ".claudeship");
}

function buildAuthorizeUrl(challenge: string, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: "codex_cli_rs",
  });
  return `${AUTHORIZE_URL}?${params}`;
}

async function exchangeCodeForTokens(code: string, verifier: string) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${body}`);
  }

  return await response.json() as {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
    token_type?: string;
  };
}

function waitForCallback(state: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${CALLBACK_PORT}`);

      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        const desc = url.searchParams.get("error_description") ?? error;
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<html><body><h2>Authentication failed</h2><p>${desc}</p><p>You can close this tab.</p></body></html>`);
        server.close();
        reject(new Error(`OAuth error: ${desc}`));
        return;
      }

      if (!code || returnedState !== state) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<html><body><h2>Invalid callback</h2><p>Missing code or state mismatch.</p></body></html>");
        server.close();
        reject(new Error("Invalid OAuth callback: missing code or state mismatch"));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body><h2>Authenticated!</h2><p>You can close this tab and return to the terminal.</p></body></html>");
      server.close();
      resolve(code);
    });

    server.listen(CALLBACK_PORT, "127.0.0.1", () => {});

    server.on("error", (err) => {
      reject(new Error(`Failed to start callback server on port ${CALLBACK_PORT}: ${err.message}`));
    });

    setTimeout(() => {
      server.close();
      reject(new Error("OAuth login timed out (120s). Please try again."));
    }, 120_000);
  });
}

export async function runOpenAILogin() {
  printInfo("OpenAI Codex OAuth Login");
  console.log(c.dim("  Authenticate with your ChatGPT account to use GPT models for free.\n"));

  const { verifier, challenge } = generatePKCE();
  const state = base64url(crypto.randomBytes(16));
  const authorizeUrl = buildAuthorizeUrl(challenge, state);

  const { default: open } = await import("open");
  const spin = spinner("Opening browser for OpenAI sign-in…");

  try {
    await open(authorizeUrl);
  } catch {
    spin.stop();
    printInfo("Could not open browser automatically. Open this URL manually:");
    console.log(`\n  ${c.path(authorizeUrl)}\n`);
  }

  spin.text = "Waiting for authentication…";

  let code: string;
  try {
    code = await waitForCallback(state);
  } catch (err) {
    spin.fail("Authentication failed");
    printError(err instanceof Error ? err.message : String(err));
    return;
  }

  spin.text = "Exchanging token…";

  let tokens: Awaited<ReturnType<typeof exchangeCodeForTokens>>;
  try {
    tokens = await exchangeCodeForTokens(code, verifier);
  } catch (err) {
    spin.fail("Token exchange failed");
    printError(err instanceof Error ? err.message : String(err));
    return;
  }

  const authDir = resolveAuthDir();
  fs.mkdirSync(authDir, { recursive: true });
  const authFile = path.join(authDir, "openai-auth.json");

  const authData = {
    tokens: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? "",
      id_token: tokens.id_token ?? "",
    },
    last_refresh: new Date().toISOString(),
  };

  fs.writeFileSync(authFile, JSON.stringify(authData, null, 2), { encoding: "utf8", mode: 0o600 });

  spin.succeed("OpenAI authentication complete");
  printSuccess(`Tokens saved to ${c.path(authFile)}`);
  console.log(c.dim("  You can now use --provider openai without an API key.\n"));
}

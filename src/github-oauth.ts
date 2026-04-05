/**
 * GitHub OAuth Device Flow for CLI authentication.
 *
 * How it works:
 *   1. POST /login/device/code  → get device_code + user_code + verification_uri
 *   2. Show user_code + URL to the user (optionally open browser)
 *   3. Poll /login/oauth/access_token until the user authorises or it expires
 *
 * Requires a GitHub OAuth App with Device Flow enabled.
 * The client_id is public (not a secret). Set CLAUDE_SHIP_CLIENT_ID to use
 * your own app, or the built-in one is used by default.
 *
 * To register your own app:
 *   GitHub → Settings → Developer Settings → OAuth Apps → New OAuth App
 *   Enable Device Flow, set any Homepage URL.
 */

// Replace with your real OAuth App client_id after registering on GitHub.
// Users can override with the CLAUDE_SHIP_CLIENT_ID env var.
const BUILT_IN_CLIENT_ID = process.env["CLAUDE_SHIP_CLIENT_ID"] ?? "";

const SCOPES = "repo read:user";

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  error?: string;
}

interface AccessTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

export interface DeviceFlowState {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
}

export class OAuthNotConfiguredError extends Error {
  constructor() {
    super(
      "OAuth requires a GitHub OAuth App client_id.\n" +
        "Set the CLAUDE_SHIP_CLIENT_ID environment variable, or use a Personal Access Token instead."
    );
    this.name = "OAuthNotConfiguredError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function post<T>(url: string, body: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
  }

  return res.json() as Promise<T>;
}

/**
 * Step 1: Request a device code from GitHub.
 * Returns the state the caller should display to the user.
 */
export async function requestDeviceCode(
  clientId = BUILT_IN_CLIENT_ID
): Promise<DeviceFlowState & { deviceCode: string; interval: number }> {
  if (!clientId) throw new OAuthNotConfiguredError();

  const data = await post<DeviceCodeResponse>(
    "https://github.com/login/device/code",
    { client_id: clientId, scope: SCOPES }
  );

  if (data.error) throw new Error(`GitHub: ${data.error}`);

  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: data.interval ?? 5,
  };
}

/**
 * Step 2: Poll until the user authorises (or it expires / is denied).
 * Calls `onPoll` before each attempt so the caller can show a spinner tick.
 */
export async function pollForToken(
  deviceCode: string,
  intervalSeconds: number,
  expiresIn: number,
  clientId = BUILT_IN_CLIENT_ID,
  onPoll?: () => void
): Promise<string> {
  if (!clientId) throw new OAuthNotConfiguredError();

  const deadline = Date.now() + expiresIn * 1000;
  let waitMs = intervalSeconds * 1000;

  while (Date.now() < deadline) {
    await sleep(waitMs);
    onPoll?.();

    const data = await post<AccessTokenResponse>(
      "https://github.com/login/oauth/access_token",
      {
        client_id: clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }
    );

    if (data.access_token) return data.access_token;

    switch (data.error) {
      case "authorization_pending":
        break; // keep polling
      case "slow_down":
        waitMs += 5000; // GitHub asked us to back off
        break;
      case "access_denied":
        throw new Error("Authorization denied by the user.");
      case "expired_token":
        throw new Error("Device code expired. Please try again.");
      default:
        if (data.error) throw new Error(`GitHub OAuth error: ${data.error}`);
    }
  }

  throw new Error("Authorization timed out. Please try again.");
}

export function isOAuthConfigured(): boolean {
  return Boolean(BUILT_IN_CLIENT_ID);
}

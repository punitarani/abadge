import { DEVICE_AUTH_CLIENT_ID } from "@abadge/auth";
import { AbadgeAgentClient, AbadgeApiError, AbadgeUserClient } from "@abadge/sdk";
import { createNodeTrpcClient } from "@abadge/trpc/client";
import type { CliConfig, SessionConfig } from "./config";
import { loadConfig } from "./config";
import { daemonAuthHeaders } from "./daemon";

// ---------------------------------------------------------------------------
// Lightweight tRPC helpers for auth operations not covered by the SDK clients
// (recordLogin, logout). These are only used during device-code login/logout.
// ---------------------------------------------------------------------------

/** @internal Record a login event via the session-authenticated tRPC client. */
export async function recordLoginViaTrpc(config: SessionConfig): Promise<void> {
  const client = createNodeTrpcClient({
    baseUrl: config.apiUrl,
    headers: config.sessionHeaders,
  });
  try {
    await client.auth.recordLogin.mutate();
  } catch (error) {
    throw AbadgeApiError.fromUnknown(error, "Failed to record login");
  }
}

/** @internal Record a logout event via the session-authenticated tRPC client. */
export async function logoutViaTrpc(config: SessionConfig): Promise<void> {
  const client = createNodeTrpcClient({
    baseUrl: config.apiUrl,
    headers: config.sessionHeaders,
  });
  try {
    await client.auth.logout.mutate();
  } catch (error) {
    throw AbadgeApiError.fromUnknown(error, "Failed to record logout");
  }
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function requireSessionBaseConfig(): CliConfig {
  const config = loadConfig();
  const apiUrl = config?.apiUrl ?? process.env.ABADGE_API_URL;
  if (!apiUrl) {
    throw new Error("ABADGE_API_URL is required or run `abadge login` first.");
  }

  return { ...(config ?? {}), apiUrl };
}

interface SessionResponse {
  session?: { id: string; userId: string };
  user?: { id: string; email: string };
}

function getErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") {
    return fallback;
  }

  if ("error" in body && typeof body.error === "string" && body.error) {
    return body.error;
  }

  if ("message" in body && typeof body.message === "string" && body.message) {
    return body.message;
  }

  return fallback;
}

function getUnknownErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export interface DeviceCodeResult {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresAt: string;
  intervalSeconds: number;
}

export interface DeviceTokenResult {
  accessToken: string;
  expiresAt: string;
  session: SessionResponse;
}

export class DeviceAuthorizationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly intervalSeconds?: number,
  ) {
    super(message);
  }
}

type RawDeviceCodeResponse = Record<string, unknown>;

function readString(body: RawDeviceCodeResponse, snake: string, camel: string): string | undefined {
  const value = body[snake] ?? body[camel];
  return typeof value === "string" && value ? value : undefined;
}

function readNumber(body: RawDeviceCodeResponse, snake: string, camel: string): number | undefined {
  const value = body[snake] ?? body[camel];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sessionHeadersFromToken(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

let tokenFromStdinPromise: Promise<string> | null = null;

async function readTokenFromStdin(): Promise<string> {
  tokenFromStdinPromise ??= (async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    const token = Buffer.concat(chunks).toString("utf8").trim();
    if (!token) {
      throw new Error("No token was provided on stdin.");
    }
    return token;
  })();

  return tokenFromStdinPromise;
}

export async function resolveSessionConfig(
  options: { tokenStdin?: boolean } = {},
): Promise<SessionConfig> {
  const config = requireSessionBaseConfig();
  const useTokenStdin = options.tokenStdin ?? process.argv.includes("--token-stdin");
  const sessionToken = process.env.ABADGE_SESSION_TOKEN;
  if (sessionToken) {
    return { ...config, sessionHeaders: sessionHeadersFromToken(sessionToken) };
  }

  if (useTokenStdin) {
    const token = await readTokenFromStdin();
    return { ...config, sessionHeaders: sessionHeadersFromToken(token) };
  }

  try {
    const daemonAuth = await daemonAuthHeaders();
    return { ...config, sessionHeaders: daemonAuth.headers };
  } catch (err) {
    throw new Error(getUnknownErrorMessage(err, "No session found. Run `abadge login` first."));
  }
}

/**
 * @deprecated Use {@link createUserApiClient} instead. This wrapper exists only
 * to ease the migration of callers that previously used `SessionApiClient`.
 */
export async function createSessionApiClient(
  options: { tokenStdin?: boolean } = {},
): Promise<AbadgeUserClient> {
  return createUserApiClient(options);
}

export async function createUserApiClient(
  options: { tokenStdin?: boolean } = {},
): Promise<AbadgeUserClient> {
  const config = await resolveSessionConfig(options);
  const authHeader = config.sessionHeaders?.Authorization ?? "";
  const sessionToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
  return new AbadgeUserClient({ apiUrl: config.apiUrl, sessionToken });
}

/**
 * Create an agent API client using env vars, config file, or legacy credentials.
 *
 * Resolution order:
 * 1. ABADGE_PRIVATE_KEY (inline JWK string) + ABADGE_AGENT_ID + ABADGE_API_URL
 * 2. ABADGE_PRIVATE_KEY_PATH (file path) + ABADGE_AGENT_ID + ABADGE_API_URL
 * 3. Config file localAgents.cli
 * 4. ABADGE_AUTH_TOKEN (legacy API key, deprecated)
 */
export async function createAgentApiClient(): Promise<AbadgeAgentClient> {
  const env = process.env;
  const config = loadConfig();
  const apiUrl = env.ABADGE_API_URL ?? config?.apiUrl;

  // 1. Inline JWK from env
  if (env.ABADGE_PRIVATE_KEY && env.ABADGE_AGENT_ID) {
    if (!apiUrl) throw new Error("ABADGE_API_URL is required.");
    const client = new AbadgeAgentClient({
      apiUrl,
      agentId: env.ABADGE_AGENT_ID,
      privateKey: env.ABADGE_PRIVATE_KEY,
    });
    await client.connect();
    return client;
  }

  // 2. JWK file path from env
  if (env.ABADGE_PRIVATE_KEY_PATH && env.ABADGE_AGENT_ID) {
    if (!apiUrl) throw new Error("ABADGE_API_URL is required.");
    const { readFileSync } = await import("node:fs");
    const jwk = JSON.parse(readFileSync(env.ABADGE_PRIVATE_KEY_PATH, "utf-8"));
    const client = new AbadgeAgentClient({
      apiUrl,
      agentId: env.ABADGE_AGENT_ID,
      privateKey: jwk,
    });
    await client.connect();
    return client;
  }

  // 3. Config file
  if (config) {
    const agentConfig = config.localAgents?.cli;
    if (agentConfig) {
      const { readFileSync } = await import("node:fs");
      const privateKeyJwk = JSON.parse(readFileSync(agentConfig.privateKeyPath, "utf-8"));
      const client = new AbadgeAgentClient({
        apiUrl: apiUrl ?? config.apiUrl,
        agentId: agentConfig.agentId,
        privateKey: privateKeyJwk,
      });
      await client.connect();
      return client;
    }

    // Legacy principalSecret/authToken from config
    const secret = config.principalSecret ?? config.authToken;
    if (secret) {
      return new AbadgeAgentClient({ apiUrl: apiUrl ?? config.apiUrl, apiKey: secret });
    }
  }

  // 4. Legacy API key from env
  if (env.ABADGE_AUTH_TOKEN) {
    if (!apiUrl) throw new Error("ABADGE_API_URL is required.");
    return new AbadgeAgentClient({ apiUrl, apiKey: env.ABADGE_AUTH_TOKEN });
  }

  throw new Error(
    "No agent credentials found.\n" +
      "hint: Set ABADGE_API_URL + ABADGE_AGENT_ID + ABADGE_PRIVATE_KEY env vars,\n" +
      "      or run `abadge agent register --kind local_cli` to configure via config file.",
  );
}

export async function requestDeviceCode(apiUrl: string): Promise<DeviceCodeResult> {
  const baseUrl = trimTrailingSlash(apiUrl);
  const res = await fetch(`${baseUrl}/api/auth/device/code`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ client_id: DEVICE_AUTH_CLIENT_ID }),
  });

  if (!res.ok) {
    const errorBody = (await res.json().catch(() => undefined)) as unknown;
    throw new Error(getErrorMessage(errorBody, `Failed to start device login (${res.status})`));
  }

  const body = (await res.json()) as RawDeviceCodeResponse;
  const deviceCode = readString(body, "device_code", "deviceCode");
  const userCode = readString(body, "user_code", "userCode");
  const verificationUri = readString(body, "verification_uri", "verificationUri");
  const verificationUriComplete =
    readString(body, "verification_uri_complete", "verificationUriComplete") ??
    (verificationUri && userCode
      ? `${verificationUri}?user_code=${encodeURIComponent(userCode)}`
      : undefined);
  const expiresInSeconds = readNumber(body, "expires_in", "expiresIn") ?? 600;
  const intervalSeconds = readNumber(body, "interval", "interval") ?? 5;

  if (!deviceCode || !userCode || !verificationUri || !verificationUriComplete) {
    throw new Error("Device login response was missing required fields.");
  }

  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    intervalSeconds,
  };
}

export async function getBearerSession(
  apiUrl: string,
  accessToken: string,
): Promise<SessionResponse> {
  const baseUrl = trimTrailingSlash(apiUrl);
  const sessionRes = await fetch(`${baseUrl}/api/auth/get-session`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!sessionRes.ok) {
    throw new Error(
      `Authenticated successfully but failed to verify session (${sessionRes.status}).`,
    );
  }

  const session = (await sessionRes.json()) as SessionResponse;
  if (!session.user?.id) {
    throw new Error("Authenticated successfully but could not verify the session.");
  }

  return session;
}

export async function exchangeDeviceToken(
  apiUrl: string,
  deviceCode: string,
  intervalSeconds: number,
): Promise<DeviceTokenResult> {
  const baseUrl = trimTrailingSlash(apiUrl);
  const res = await fetch(`${baseUrl}/api/auth/device/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: DEVICE_AUTH_CLIENT_ID,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });

  const body = (await res.json().catch(() => undefined)) as RawDeviceCodeResponse | undefined;
  if (!res.ok) {
    const code = body && typeof body.error === "string" ? body.error : `http_${res.status}`;
    const nextInterval = code === "slow_down" ? intervalSeconds + 5 : intervalSeconds;
    throw new DeviceAuthorizationError(
      code,
      getErrorMessage(body, `Device authorization failed (${res.status})`),
      nextInterval,
    );
  }

  const accessToken = body ? readString(body, "access_token", "accessToken") : undefined;
  const expiresInSeconds = body ? readNumber(body, "expires_in", "expiresIn") : undefined;
  if (!accessToken) {
    throw new Error("Device token response did not include an access token.");
  }

  const session = await getBearerSession(apiUrl, accessToken);
  return {
    accessToken,
    expiresAt: new Date(Date.now() + (expiresInSeconds ?? 24 * 60 * 60) * 1000).toISOString(),
    session,
  };
}

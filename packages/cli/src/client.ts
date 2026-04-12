import { DEVICE_AUTH_CLIENT_ID } from "@abadge/auth";
import type {
  AgentListResult,
  AgentResult,
  AgentRotateResult,
  AgentWithKey,
  AuditFilters,
  AuditListResult,
  CreateAgentInput,
  CreateItemInput,
  CreatePermissionInput,
  ItemListResult,
  ItemResult,
  PermissionFilters,
  PermissionListResult,
  PermissionResult,
  SuccessResult,
  UpdateItemInput,
} from "@abadge/sdk";
import { AbadgeAgentClient, AbadgeApiError, AbadgeUserClient } from "@abadge/sdk";
import { createNodeTrpcClient } from "@abadge/trpc/client";
import type { CliConfig, PrincipalConfig, SessionConfig } from "./config";
import { loadConfig } from "./config";
import { daemonAuthHeaders } from "./daemon";

type SessionTrpcClient = ReturnType<typeof createNodeTrpcClient>;

function getPrincipalSecret(config: PrincipalConfig | CliConfig): string {
  const secret = config.principalSecret ?? config.authToken;
  if (!secret) {
    throw new Error("Local agent credential is required.");
  }
  return secret;
}

export class ApiClient extends AbadgeAgentClient {
  constructor(config: PrincipalConfig | CliConfig) {
    super({
      apiUrl: config.apiUrl,
      apiKey: getPrincipalSecret(config),
    });
  }
}

export class SessionApiClient {
  private readonly client: SessionTrpcClient;

  constructor(config: SessionConfig) {
    this.client = createNodeTrpcClient({
      baseUrl: config.apiUrl,
      headers: config.sessionHeaders,
    });
  }

  async createItem(data: CreateItemInput): Promise<{ id: string }> {
    return this.call(() => this.client.items.create.mutate(data), "Failed to create item");
  }

  async listItems(): Promise<ItemListResult> {
    return this.call(() => this.client.items.list.query(), "Failed to list items");
  }

  async getItem(id: string): Promise<ItemResult> {
    return this.call(() => this.client.items.get.query({ itemId: id }), "Failed to fetch item");
  }

  async deleteItem(id: string): Promise<SuccessResult> {
    return this.call(
      () => this.client.items.delete.mutate({ itemId: id }),
      "Failed to delete item",
    );
  }

  async updateItem(
    id: string,
    data: UpdateItemInput,
  ): Promise<{ ok: boolean; contentVersion: number }> {
    return this.call(
      () => this.client.items.update.mutate({ itemId: id, data }),
      "Failed to update item",
    );
  }

  async createAgent(data: CreateAgentInput): Promise<AgentWithKey> {
    return this.call(() => this.client.agents.create.mutate(data), "Failed to create agent");
  }

  async listAgents(): Promise<AgentListResult> {
    return this.call(() => this.client.agents.list.query(), "Failed to list agents");
  }

  async rotateAgent(id: string): Promise<AgentRotateResult> {
    return this.call(
      () => this.client.agents.rotate.mutate({ agentId: id }),
      "Failed to rotate agent",
    );
  }

  async getAgent(id: string): Promise<AgentResult> {
    return this.call(() => this.client.agents.get.query({ agentId: id }), "Failed to fetch agent");
  }

  async revokeAgent(id: string): Promise<SuccessResult> {
    return this.call(
      () => this.client.agents.revoke.mutate({ agentId: id }),
      "Failed to revoke agent",
    );
  }

  async createPermission(data: CreatePermissionInput): Promise<PermissionResult> {
    return this.call(
      () => this.client.permissions.create.mutate(data),
      "Failed to create permission",
    );
  }

  async listPermissions(filters: PermissionFilters = {}): Promise<PermissionListResult> {
    return this.call(
      () => this.client.permissions.list.query(filters),
      "Failed to list permissions",
    );
  }

  async revokePermission(id: string): Promise<SuccessResult> {
    return this.call(
      () => this.client.permissions.revoke.mutate({ permissionId: id }),
      "Failed to revoke permission",
    );
  }

  async getAudit(filters: AuditFilters = {}): Promise<AuditListResult> {
    return this.call(() => this.client.audit.list.query(filters), "Failed to fetch audit log");
  }

  async recordLogin(): Promise<SuccessResult> {
    return this.call(() => this.client.auth.recordLogin.mutate(), "Failed to record login");
  }

  async logout(): Promise<SuccessResult> {
    return this.call(() => this.client.auth.logout.mutate(), "Failed to record logout");
  }

  private async call<T>(operation: () => Promise<T>, fallback: string): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw AbadgeApiError.fromUnknown(error, fallback);
    }
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

export async function createSessionApiClient(
  options: { tokenStdin?: boolean } = {},
): Promise<SessionApiClient> {
  return new SessionApiClient(await resolveSessionConfig(options));
}

export async function createUserApiClient(
  options: { tokenStdin?: boolean } = {},
): Promise<AbadgeUserClient> {
  const config = await resolveSessionConfig(options);
  const authHeader = config.sessionHeaders?.Authorization ?? "";
  const sessionToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
  return new AbadgeUserClient({ apiUrl: config.apiUrl, sessionToken });
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

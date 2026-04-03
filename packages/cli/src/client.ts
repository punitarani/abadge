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
import { AbadgeApiError, AbadgeClient } from "@abadge/sdk";
import { createNodeTrpcClient } from "@abadge/trpc/client";
import type { CliConfig, PrincipalConfig, SessionConfig } from "./config";

type SessionTrpcClient = ReturnType<typeof createNodeTrpcClient>;

function getPrincipalSecret(config: PrincipalConfig | CliConfig): string {
  const secret = config.principalSecret ?? config.authToken;
  if (!secret) {
    throw new Error("Local agent credential is required.");
  }
  return secret;
}

export class ApiClient extends AbadgeClient {
  constructor(config: PrincipalConfig | CliConfig) {
    super({
      apiUrl: config.apiUrl,
      token: getPrincipalSecret(config),
    });
  }
}

export class SessionApiClient {
  private readonly client: SessionTrpcClient;

  constructor(config: SessionConfig | CliConfig) {
    if (!config.sessionCookie) {
      throw new Error("Session cookie is required.");
    }

    this.client = createNodeTrpcClient({
      baseUrl: config.apiUrl,
      headers: {
        Cookie: config.sessionCookie,
      },
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

function looksLikeCookieBoundary(raw: string, index: number): boolean {
  return /^\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=/.test(raw.slice(index + 1));
}

function isQuoteBoundary(raw: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && raw[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 0;
}

type CookieSplitState = {
  values: string[];
  current: string;
  inExpires: boolean;
  inQuotes: boolean;
};

function pushSplitCookie(state: CookieSplitState): void {
  const value = state.current.trim();
  if (value) {
    state.values.push(value);
  }
  state.current = "";
}

function toggleQuoteState(
  raw: string,
  index: number,
  char: string,
  state: CookieSplitState,
): boolean {
  if (char !== '"' || !isQuoteBoundary(raw, index)) {
    return false;
  }

  state.inQuotes = !state.inQuotes;
  return true;
}

function maybeStartExpires(lower: string, index: number, state: CookieSplitState): boolean {
  if (state.inQuotes || !lower.startsWith("expires=", index)) {
    return false;
  }

  state.inExpires = true;
  return true;
}

function maybeSplitExpiresCookie(
  raw: string,
  index: number,
  char: string,
  state: CookieSplitState,
): boolean {
  if (!state.inExpires) {
    return false;
  }

  if (char === ";") {
    state.inExpires = false;
    return true;
  }

  if (char === "," && looksLikeCookieBoundary(raw, index)) {
    state.inExpires = false;
    state.current = state.current.slice(0, -1);
    pushSplitCookie(state);
    return true;
  }

  return true;
}

function maybeSplitCookieBoundary(
  raw: string,
  index: number,
  char: string,
  state: CookieSplitState,
): boolean {
  if (state.inQuotes || char !== "," || !looksLikeCookieBoundary(raw, index)) {
    return false;
  }

  state.current = state.current.slice(0, -1);
  pushSplitCookie(state);
  return true;
}

export function splitCombinedSetCookieHeader(raw: string): string[] {
  const state: CookieSplitState = {
    values: [],
    current: "",
    inExpires: false,
    inQuotes: false,
  };
  const lower = raw.toLowerCase();

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw.charAt(index);
    state.current += char;

    if (toggleQuoteState(raw, index, char, state)) {
      continue;
    }
    if (maybeStartExpires(lower, index, state)) {
      continue;
    }
    if (maybeSplitExpiresCookie(raw, index, char, state)) {
      continue;
    }
    maybeSplitCookieBoundary(raw, index, char, state);
  }

  pushSplitCookie(state);
  return state.values;
}

function getSetCookieHeaders(headers: Headers): string[] {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === "function") {
    const values = getSetCookie.call(headers).filter(Boolean);
    if (values.length > 0) {
      return values;
    }
  }

  const raw = headers.get("set-cookie");
  return raw ? splitCombinedSetCookieHeader(raw) : [];
}

function toCookieHeader(setCookies: string[]): string {
  const cookies = setCookies
    .map((value) => value.split(";", 1)[0]?.trim())
    .filter((value): value is string => Boolean(value));

  if (cookies.length === 0) {
    throw new Error("Authentication succeeded but no session cookie was returned.");
  }

  return cookies.join("; ");
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

export async function signInWithEmail(
  apiUrl: string,
  email: string,
  password: string,
): Promise<{ sessionCookie: string; session: SessionResponse }> {
  const baseUrl = trimTrailingSlash(apiUrl);
  const res = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const errorBody = (await res.json().catch(() => undefined)) as unknown;
    throw new Error(getErrorMessage(errorBody, `Login failed (${res.status})`));
  }

  const sessionCookie = toCookieHeader(getSetCookieHeaders(res.headers));
  const sessionRes = await fetch(`${baseUrl}/api/auth/get-session`, {
    headers: {
      Accept: "application/json",
      Cookie: sessionCookie,
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

  return { sessionCookie, session };
}

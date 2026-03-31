import type { ApprovalStatus, DeliveryMode, Environment } from "./constants";
import { ERROR_CODES } from "./constants";
import {
  AbadgeError,
  ApprovalRequiredError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "./errors";
import type {
  CreateAgentInput,
  CreateConnectorInput,
  CreateCredentialInput,
  CreatePolicyInput,
  CreateSessionInput,
  GrantPermissionInput,
  RevokePermissionInput,
  UpdateCredentialInput,
  UpdatePolicyInput,
} from "./schemas";
import type {
  AccessLogEntry,
  Agent,
  AgentRegistrationResponse,
  Approval,
  Connector,
  Credential,
  CredentialAccessResponse,
  Permission,
  Policy,
} from "./types";

export interface AbadgeClientConfig {
  apiUrl: string;
  token: string;
}

export class AbadgeClient {
  private readonly apiUrl: string;
  private readonly token: string;

  constructor(config: AbadgeClientConfig) {
    this.apiUrl = config.apiUrl.replace(/\/$/, "");
    this.token = config.token;
  }

  private parseErrorBody(text: string, fallback: string): { message: string; code: string } {
    try {
      const parsed = JSON.parse(text) as { error?: string; code?: string };
      return {
        message: parsed.error ?? fallback,
        code: parsed.code ?? "UNKNOWN",
      };
    } catch {
      return { message: text || fallback, code: "UNKNOWN" };
    }
  }

  private throwForStatus(status: number, code: string, message: string): never {
    switch (status) {
      case 202:
        throw new ApprovalRequiredError(message);
      case 401:
        throw new UnauthorizedError(ERROR_CODES.UNAUTHORIZED, message);
      case 403:
        throw new ForbiddenError(
          code === ERROR_CODES.POLICY_VIOLATION
            ? ERROR_CODES.POLICY_VIOLATION
            : ERROR_CODES.ACCESS_DENIED,
          message,
        );
      case 404:
        throw new NotFoundError(ERROR_CODES.CREDENTIAL_NOT_FOUND, message);
      default:
        throw new AbadgeError(code, message, status);
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
    };

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(`${this.apiUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const fallback = `API ${method} ${path} failed (${res.status})`;
      const { message, code } = this.parseErrorBody(text, fallback);
      this.throwForStatus(res.status, code, message);
    }

    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  // --- Auth ---

  async whoami(): Promise<{ user: { id: string; name: string; email: string } }> {
    return this.request("GET", "/api/auth/get-session");
  }

  // --- Credentials ---

  async listCredentials(): Promise<{ credentials: Credential[] }> {
    return this.request("GET", "/v1/credentials");
  }

  async getCredential(idOrName: string): Promise<{ credential: Credential }> {
    return this.request("GET", `/v1/credentials/${encodeURIComponent(idOrName)}`);
  }

  async createCredential(
    input: CreateCredentialInput,
  ): Promise<{ credential: { id: string; name: string } }> {
    return this.request("POST", "/v1/credentials", input);
  }

  async updateCredential(
    id: string,
    input: UpdateCredentialInput,
  ): Promise<{ credential: { id: string; name: string } }> {
    return this.request("PUT", `/v1/credentials/${encodeURIComponent(id)}`, input);
  }

  async deleteCredential(id: string): Promise<{ success: boolean }> {
    return this.request("DELETE", `/v1/credentials/${encodeURIComponent(id)}`);
  }

  async accessCredential(input: {
    credentialId?: string;
    credentialName?: string;
    deliveryMode?: DeliveryMode;
    purpose?: string;
    destination?: string;
    environment?: Environment;
    sessionId?: string;
  }): Promise<CredentialAccessResponse> {
    return this.request("POST", "/v1/credentials/access", input);
  }

  // --- Agents ---

  async listAgents(): Promise<{ agents: Agent[] }> {
    return this.request("GET", "/v1/agents");
  }

  async createAgent(input: CreateAgentInput): Promise<AgentRegistrationResponse> {
    return this.request("POST", "/v1/agents", input);
  }

  async deleteAgent(id: string): Promise<{ success: boolean }> {
    return this.request("DELETE", `/v1/agents/${encodeURIComponent(id)}`);
  }

  // --- Permissions ---

  async listPermissions(credentialId: string): Promise<{ permissions: Permission[] }> {
    return this.request("GET", `/v1/permissions/credential/${encodeURIComponent(credentialId)}`);
  }

  async grantPermission(input: GrantPermissionInput): Promise<{ success: boolean }> {
    return this.request("POST", "/v1/permissions/grant", input);
  }

  async revokePermission(input: RevokePermissionInput): Promise<{ success: boolean }> {
    return this.request("POST", "/v1/permissions/revoke", input);
  }

  // --- Sessions ---

  async createSession(
    input: CreateSessionInput,
  ): Promise<{ sessionId: string; token: string; expiresAt: string }> {
    return this.request("POST", "/v1/sessions", input);
  }

  async revokeSession(id: string): Promise<{ success: boolean }> {
    return this.request("DELETE", `/v1/sessions/${encodeURIComponent(id)}`);
  }

  // --- Policies ---

  async listPolicies(): Promise<{ policies: Policy[] }> {
    return this.request("GET", "/v1/policies");
  }

  async createPolicy(input: CreatePolicyInput): Promise<{ policy: Policy }> {
    return this.request("POST", "/v1/policies", input);
  }

  async updatePolicy(id: string, input: UpdatePolicyInput): Promise<{ policy: Policy }> {
    return this.request("PUT", `/v1/policies/${encodeURIComponent(id)}`, input);
  }

  async deletePolicy(id: string): Promise<{ success: boolean }> {
    return this.request("DELETE", `/v1/policies/${encodeURIComponent(id)}`);
  }

  // --- Approvals ---

  async listApprovals(status?: ApprovalStatus): Promise<{ approvals: Approval[] }> {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.request("GET", `/v1/approvals${query}`);
  }

  async approveRequest(id: string, reason?: string): Promise<{ success: boolean }> {
    return this.request("POST", `/v1/approvals/${encodeURIComponent(id)}/approve`, {
      reason,
    });
  }

  async denyRequest(id: string, reason?: string): Promise<{ success: boolean }> {
    return this.request("POST", `/v1/approvals/${encodeURIComponent(id)}/deny`, {
      reason,
    });
  }

  // --- Connectors ---

  async listConnectors(): Promise<{ connectors: Connector[] }> {
    return this.request("GET", "/v1/connectors");
  }

  async createConnector(
    input: CreateConnectorInput,
  ): Promise<{ connector: { id: string; name: string } }> {
    return this.request("POST", "/v1/connectors", input);
  }

  async testConnector(id: string): Promise<{ success: boolean; error?: string }> {
    return this.request("POST", `/v1/connectors/${encodeURIComponent(id)}/test`);
  }

  // --- Audit ---

  async getAuditLog(params?: {
    limit?: number;
    offset?: number;
  }): Promise<{ logs: AccessLogEntry[]; total: number }> {
    const searchParams = new URLSearchParams();
    if (params?.limit != null) searchParams.set("limit", String(params.limit));
    if (params?.offset != null) searchParams.set("offset", String(params.offset));
    const query = searchParams.toString();
    return this.request("GET", `/v1/audit${query ? `?${query}` : ""}`);
  }
}

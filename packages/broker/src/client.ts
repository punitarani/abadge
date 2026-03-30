import type { BrokerConfig, SecretAccessResult } from "./types";

export class AbadgeClient {
  private readonly apiUrl: string;
  private readonly headers: Record<string, string>;

  constructor(config: BrokerConfig) {
    this.apiUrl = config.apiUrl.replace(/\/$/, "");
    this.headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.token}`,
    };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.apiUrl}${path}`, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API ${method} ${path} failed (${res.status}): ${text}`);
    }
    return res.json() as Promise<T>;
  }

  // Auth

  async login(email: string, password: string): Promise<{ token: string }> {
    return this.request("POST", "/api/auth/sign-in/email", { email, password });
  }

  async whoami(): Promise<{ user: { id: string; name: string; email: string } }> {
    return this.request("GET", "/api/auth/get-session");
  }

  // Secrets

  async listSecrets(): Promise<{
    credentials: Array<{
      id: string;
      name: string;
      type: string;
      environment?: string;
      sensitivity?: string;
    }>;
  }> {
    return this.request("GET", "/v1/credentials");
  }

  async getSecretMetadata(idOrName: string): Promise<{
    credential: {
      id: string;
      name: string;
      type: string;
      metadata?: Record<string, string> | null;
    };
  }> {
    return this.request("GET", `/credentials/${encodeURIComponent(idOrName)}`);
  }

  async accessSecret(params: {
    credentialId?: string;
    credentialName?: string;
    deliveryMode: string;
    purpose?: string;
    destination?: string;
  }): Promise<SecretAccessResult> {
    return this.request("POST", "/v1/credentials/access", params);
  }

  // Grants

  async listGrants(credentialId: string): Promise<{
    permissions: Array<{
      agentId: string;
      credentialId: string;
      grantedAt: string;
      grantedBy: string;
    }>;
  }> {
    return this.request("GET", `/credentials/${encodeURIComponent(credentialId)}/grants`);
  }

  async createGrant(params: {
    agentId: string;
    credentialId: string;
    policyId?: string;
    allowedDeliveryModes?: string[];
  }): Promise<void> {
    await this.request("POST", "/v1/permissions/grant", params);
  }

  // Sessions

  async createSession(params: {
    agentId: string;
    scopes?: string[];
    allowedDeliveryModes?: string[];
    ttlSeconds: number;
  }): Promise<{ sessionId: string; token: string; expiresAt: string }> {
    return this.request("POST", "/v1/sessions", params);
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.request("DELETE", `/v1/sessions/${encodeURIComponent(sessionId)}`);
  }

  // Approvals

  async listApprovals(status?: string): Promise<{
    approvals: Array<{
      id: string;
      status: string;
      credentialId: string;
      agentId: string;
      requestedAt: string;
    }>;
  }> {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.request("GET", `/approvals${query}`);
  }

  async approveRequest(approvalId: string, reason?: string): Promise<void> {
    await this.request("POST", `/approvals/${encodeURIComponent(approvalId)}/approve`, {
      reason,
    });
  }

  async denyRequest(approvalId: string, reason?: string): Promise<void> {
    await this.request("POST", `/approvals/${encodeURIComponent(approvalId)}/deny`, { reason });
  }

  // Audit

  async getAuditLog(params?: { limit?: number; offset?: number }): Promise<{
    logs: Array<{
      id: number;
      agentId: string;
      credentialId: string;
      action: string;
      timestamp: string;
    }>;
  }> {
    const searchParams = new URLSearchParams();
    if (params?.limit != null) searchParams.set("limit", String(params.limit));
    if (params?.offset != null) searchParams.set("offset", String(params.offset));
    const query = searchParams.toString();
    return this.request("GET", `/v1/audit${query ? `?${query}` : ""}`);
  }

  // Connectors

  async listConnectors(): Promise<{
    connectors: Array<{ id: string; name: string; type: string }>;
  }> {
    return this.request("GET", "/v1/connectors");
  }

  async createConnector(params: {
    name: string;
    type: string;
    config?: Record<string, string>;
  }): Promise<void> {
    await this.request("POST", "/v1/connectors", params);
  }
}

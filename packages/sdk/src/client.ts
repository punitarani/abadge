import { AbadgeApiError } from "./errors";
import type {
  AuditEntry,
  AuditFilters,
  BootstrapVaultInput,
  ChangePasswordInput,
  CiphertextAccessResponse,
  CreateGrantInput,
  CreateItemInput,
  CreatePrincipalInput,
  Grant,
  GrantFilters,
  Item,
  MountAccessResponse,
  Principal,
  PrincipalWithKey,
  RevealAccessResponse,
  RotateKeyInput,
  SetupRecoveryInput,
  UpdateItemInput,
  Vault,
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

  // --- Vault ---

  async bootstrapVault(data: BootstrapVaultInput): Promise<{ vault: Vault }> {
    return this.request("PUT", "/v1/vault/bootstrap", data);
  }

  async getVault(): Promise<{ vault: Vault }> {
    return this.request("GET", "/v1/vault");
  }

  async changePassword(data: ChangePasswordInput): Promise<{ success: boolean }> {
    return this.request("POST", "/v1/vault/change-password", data);
  }

  async rotateKey(data: RotateKeyInput): Promise<{ success: boolean }> {
    return this.request("POST", "/v1/vault/rotate-key", data);
  }

  async setupRecovery(data: SetupRecoveryInput): Promise<{ success: boolean }> {
    return this.request("POST", "/v1/vault/recovery/setup", data);
  }

  // --- Items ---

  async createItem(data: CreateItemInput): Promise<{ item: Item }> {
    return this.request("POST", "/v1/items", data);
  }

  async listItems(): Promise<{ items: Item[] }> {
    return this.request("GET", "/v1/items");
  }

  async getItem(id: string): Promise<{ item: Item }> {
    return this.request("GET", `/v1/items/${encodeURIComponent(id)}`);
  }

  async updateItem(id: string, data: UpdateItemInput): Promise<{ item: Item }> {
    return this.request("PUT", `/v1/items/${encodeURIComponent(id)}`, data);
  }

  async deleteItem(id: string): Promise<{ success: boolean }> {
    return this.request("DELETE", `/v1/items/${encodeURIComponent(id)}`);
  }

  // --- Principals ---

  async createPrincipal(data: CreatePrincipalInput): Promise<PrincipalWithKey> {
    return this.request("POST", "/v1/principals", data);
  }

  async listPrincipals(): Promise<{ principals: Principal[] }> {
    return this.request("GET", "/v1/principals");
  }

  async rotatePrincipal(id: string): Promise<PrincipalWithKey> {
    return this.request("POST", `/v1/principals/${encodeURIComponent(id)}/rotate`);
  }

  async revokePrincipal(id: string): Promise<{ success: boolean }> {
    return this.request("POST", `/v1/principals/${encodeURIComponent(id)}/revoke`);
  }

  // --- Grants ---

  async createGrant(data: CreateGrantInput): Promise<{ grant: Grant }> {
    return this.request("POST", "/v1/grants", data);
  }

  async listGrants(filters?: GrantFilters): Promise<{ grants: Grant[] }> {
    const query = filters ? buildQuery({ ...filters }) : "";
    return this.request("GET", `/v1/grants${query}`);
  }

  async revokeGrant(id: string): Promise<{ success: boolean }> {
    return this.request("DELETE", `/v1/grants/${encodeURIComponent(id)}`);
  }

  // --- Access ---

  async accessCiphertext(itemId: string): Promise<CiphertextAccessResponse> {
    return this.request("POST", "/v1/access/ciphertext", { itemId });
  }

  async accessReveal(itemId: string): Promise<RevealAccessResponse> {
    return this.request("POST", "/v1/access/reveal", { itemId });
  }

  async accessMount(itemId: string, mountType: string): Promise<MountAccessResponse> {
    return this.request("POST", "/v1/access/mount", { itemId, mountType });
  }

  // --- Audit ---

  async getAudit(filters?: AuditFilters): Promise<{ entries: AuditEntry[]; total: number }> {
    const query = filters ? buildQuery({ ...filters }) : "";
    return this.request("GET", `/v1/audit${query}`);
  }

  // --- Internal ---

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
      throw await AbadgeApiError.fromResponse(
        res,
        `API ${method} ${path} failed (${res.status})`,
      );
    }

    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }
}

function buildQuery(params?: Record<string, string | number | undefined>): string {
  if (!params) return "";
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null) {
      searchParams.set(key, String(value));
    }
  }
  const str = searchParams.toString();
  return str ? `?${str}` : "";
}

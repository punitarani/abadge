import { AbadgeApiError } from "./errors";
import { createNodeTrpcClient } from "./trpc";
import type {
  AuditFilters,
  AuditListResult,
  BootstrapVaultInput,
  ChangePasswordInput,
  CiphertextAccessResponse,
  CreateGrantInput,
  CreateItemInput,
  CreatePrincipalInput,
  GrantFilters,
  GrantListResult,
  GrantResult,
  ItemListResult,
  ItemResult,
  MountAccessResponse,
  PrincipalListResult,
  PrincipalRotateResult,
  PrincipalWithKey,
  RevealAccessResponse,
  RotateKeyInput,
  SetupRecoveryInput,
  SuccessResult,
  UpdateItemInput,
  VaultResult,
} from "./types";

export interface AbadgeClientConfig {
  apiUrl: string;
  token: string;
}

interface TrpcMutation<TInput, TOutput> {
  mutate(input: TInput): Promise<TOutput>;
}

interface TrpcQuery<TInput, TOutput> {
  query(input: TInput): Promise<TOutput>;
}

interface TrpcQueryWithoutInput<TOutput> {
  query(): Promise<TOutput>;
}

interface SdkTrpcClient {
  vault: {
    bootstrap: TrpcMutation<BootstrapVaultInput, { id: string }>;
    get: TrpcQueryWithoutInput<VaultResult>;
    changePassword: TrpcMutation<ChangePasswordInput, SuccessResult>;
    rotateKey: TrpcMutation<RotateKeyInput, { ok: boolean; keyVersion: number }>;
    setupRecovery: TrpcMutation<SetupRecoveryInput, SuccessResult>;
  };
  items: {
    create: TrpcMutation<CreateItemInput, { id: string }>;
    list: TrpcQueryWithoutInput<ItemListResult>;
    get: TrpcQuery<{ itemId: string }, ItemResult>;
    update: TrpcMutation<
      { itemId: string; data: UpdateItemInput },
      { ok: boolean; contentVersion: number }
    >;
    delete: TrpcMutation<{ itemId: string }, SuccessResult>;
  };
  principals: {
    create: TrpcMutation<CreatePrincipalInput, PrincipalWithKey>;
    list: TrpcQueryWithoutInput<PrincipalListResult>;
    rotate: TrpcMutation<{ principalId: string }, PrincipalRotateResult>;
    revoke: TrpcMutation<{ principalId: string }, SuccessResult>;
  };
  grants: {
    create: TrpcMutation<CreateGrantInput, GrantResult>;
    list: TrpcQuery<GrantFilters, GrantListResult>;
    revoke: TrpcMutation<{ grantId: string }, SuccessResult>;
  };
  access: {
    ciphertext: TrpcMutation<{ itemId: string }, CiphertextAccessResponse>;
    reveal: TrpcMutation<{ itemId: string }, RevealAccessResponse>;
    mount: TrpcMutation<{ itemId: string; mountType: "env" | "file" }, MountAccessResponse>;
  };
  audit: {
    list: TrpcQuery<AuditFilters, AuditListResult>;
  };
}

export class AbadgeClient {
  private readonly client: SdkTrpcClient;

  constructor(config: AbadgeClientConfig) {
    this.client = createNodeTrpcClient({
      baseUrl: config.apiUrl,
      token: config.token,
    }) as unknown as SdkTrpcClient;
  }

  // --- Vault ---

  async bootstrapVault(data: BootstrapVaultInput): Promise<{ id: string }> {
    return this.call(() => this.client.vault.bootstrap.mutate(data), "Failed to bootstrap vault");
  }

  async getVault(): Promise<VaultResult> {
    return this.call(() => this.client.vault.get.query(), "Failed to fetch vault");
  }

  async changePassword(data: ChangePasswordInput): Promise<SuccessResult> {
    return this.call(
      () => this.client.vault.changePassword.mutate(data),
      "Failed to change password",
    );
  }

  async rotateKey(data: RotateKeyInput): Promise<{ ok: boolean; keyVersion: number }> {
    return this.call(() => this.client.vault.rotateKey.mutate(data), "Failed to rotate key");
  }

  async setupRecovery(data: SetupRecoveryInput): Promise<SuccessResult> {
    return this.call(
      () => this.client.vault.setupRecovery.mutate(data),
      "Failed to set up recovery",
    );
  }

  // --- Items ---

  async createItem(data: CreateItemInput): Promise<{ id: string }> {
    return this.call(() => this.client.items.create.mutate(data), "Failed to create item");
  }

  async listItems(): Promise<ItemListResult> {
    return this.call(() => this.client.items.list.query(), "Failed to list items");
  }

  async getItem(id: string): Promise<ItemResult> {
    return this.call(() => this.client.items.get.query({ itemId: id }), "Failed to fetch item");
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

  async deleteItem(id: string): Promise<SuccessResult> {
    return this.call(
      () => this.client.items.delete.mutate({ itemId: id }),
      "Failed to delete item",
    );
  }

  // --- Principals ---

  async createPrincipal(data: CreatePrincipalInput): Promise<PrincipalWithKey> {
    return this.call(
      () => this.client.principals.create.mutate(data),
      "Failed to create principal",
    );
  }

  async listPrincipals(): Promise<PrincipalListResult> {
    return this.call(() => this.client.principals.list.query(), "Failed to list principals");
  }

  async rotatePrincipal(id: string): Promise<PrincipalRotateResult> {
    return this.call(
      () => this.client.principals.rotate.mutate({ principalId: id }),
      "Failed to rotate principal",
    );
  }

  async revokePrincipal(id: string): Promise<SuccessResult> {
    return this.call(
      () => this.client.principals.revoke.mutate({ principalId: id }),
      "Failed to revoke principal",
    );
  }

  // --- Grants ---

  async createGrant(data: CreateGrantInput): Promise<GrantResult> {
    return this.call(() => this.client.grants.create.mutate(data), "Failed to create grant");
  }

  async listGrants(filters: GrantFilters = {}): Promise<GrantListResult> {
    return this.call(() => this.client.grants.list.query(filters), "Failed to list grants");
  }

  async revokeGrant(id: string): Promise<SuccessResult> {
    return this.call(
      () => this.client.grants.revoke.mutate({ grantId: id }),
      "Failed to revoke grant",
    );
  }

  // --- Access ---

  async accessCiphertext(itemId: string): Promise<CiphertextAccessResponse> {
    return this.call(
      () => this.client.access.ciphertext.mutate({ itemId }),
      "Failed to access ciphertext",
    );
  }

  async accessReveal(itemId: string): Promise<RevealAccessResponse> {
    return this.call(() => this.client.access.reveal.mutate({ itemId }), "Failed to reveal item");
  }

  async accessMount(itemId: string, mountType: "env" | "file"): Promise<MountAccessResponse> {
    return this.call(
      () => this.client.access.mount.mutate({ itemId, mountType }),
      "Failed to access mount payload",
    );
  }

  // --- Audit ---

  async getAudit(filters: AuditFilters = {}): Promise<AuditListResult> {
    return this.call(() => this.client.audit.list.query(filters), "Failed to fetch audit log");
  }

  // --- Internal ---

  private async call<T>(operation: () => Promise<T>, fallback: string): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw AbadgeApiError.fromUnknown(error, fallback);
    }
  }
}

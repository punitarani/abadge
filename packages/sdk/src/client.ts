import { AbadgeApiError } from "./errors";
import { createNodeTrpcClient } from "./trpc";
import type {
  AgentListResult,
  AgentRotateResult,
  AgentWithKey,
  AuditFilters,
  AuditListResult,
  BootstrapVaultInput,
  ChangePasswordInput,
  CiphertextAccessResponse,
  CreateAgentInput,
  CreateItemInput,
  CreatePermissionInput,
  ItemListResult,
  ItemResult,
  MountAccessResponse,
  PermissionFilters,
  PermissionListResult,
  PermissionResult,
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
  agents: {
    create: TrpcMutation<CreateAgentInput, AgentWithKey>;
    list: TrpcQueryWithoutInput<AgentListResult>;
    rotate: TrpcMutation<{ agentId: string }, AgentRotateResult>;
    revoke: TrpcMutation<{ agentId: string }, SuccessResult>;
  };
  permissions: {
    create: TrpcMutation<CreatePermissionInput, PermissionResult>;
    list: TrpcQuery<PermissionFilters, PermissionListResult>;
    revoke: TrpcMutation<{ permissionId: string }, SuccessResult>;
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

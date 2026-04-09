import type { ErrorCode } from "@abadge/core";
import { AbadgeApiError } from "./errors";
import { createNodeTrpcClient } from "./trpc";
import type {
  AgentListResult,
  AgentResult,
  AgentRotateResult,
  AgentWithKey,
  AuditFilters,
  AuditListResult,
  BootstrapVaultInput,
  ChangePasswordInput,
  CiphertextAccessResponse,
  CreateAgentInput,
  CreateItemInput,
  CreateOperatorTokenInput,
  CreatePermissionInput,
  ItemListResult,
  ItemResult,
  MountAccessResponse,
  OperatorTokenCreateResult,
  OperatorTokenListResult,
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

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

/** Configuration for user-facing SDK clients (session token auth). */
export interface AbadgeUserClientConfig {
  /** API endpoint URL (no trailing slash). */
  apiUrl: string;
  /** User session token. */
  sessionToken: string;
}

/** Configuration for agent SDK clients (API key or session token auth). */
export interface AbadgeAgentClientConfig {
  /** API endpoint URL (no trailing slash). */
  apiUrl: string;
  /** Agent API key (prefixed `abl_`, `abg_`) or session token (prefixed `abs_`). */
  apiKey: string;
}

/**
 * Backward-compatible config that accepts either persona.
 *
 * @deprecated Prefer {@link AbadgeUserClientConfig} or {@link AbadgeAgentClientConfig}.
 */
export interface AbadgeClientConfig {
  /** API endpoint URL (no trailing slash). */
  apiUrl: string;
  /** Session token (user) or agent API key (prefixed `abl_`, `abg_`, `abs_`). */
  token: string;
}

// ---------------------------------------------------------------------------
// SdkTrpcClient — locally declared proxy type
// ---------------------------------------------------------------------------
// WARNING: This interface is a local mirror of the server tRPC router shape.
// It cannot import from @abadge/trpc to avoid circular workspace deps.
// If the server router changes, this interface must be updated manually.
// The public-api.typecheck.ts file contains build-time assertions that
// catch drift for the most critical method signatures.

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
    ownerReveal: TrpcMutation<{ itemId: string }, RevealAccessResponse>;
    delete: TrpcMutation<{ itemId: string }, SuccessResult>;
  };
  agents: {
    create: TrpcMutation<CreateAgentInput, AgentWithKey>;
    list: TrpcQueryWithoutInput<AgentListResult>;
    self: TrpcQueryWithoutInput<AgentResult>;
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
  auth: {
    createOperatorToken: TrpcMutation<CreateOperatorTokenInput, OperatorTokenCreateResult>;
    listOperatorTokens: TrpcQueryWithoutInput<OperatorTokenListResult>;
    revokeOperatorToken: TrpcMutation<{ tokenId: string }, SuccessResult>;
  };
}

// ---------------------------------------------------------------------------
// Shared call() helper
// ---------------------------------------------------------------------------

async function call<T>(operation: () => Promise<T>, fallback: string): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw AbadgeApiError.fromUnknown(error, fallback);
  }
}

function buildTrpcClient(apiUrl: string, token: string): SdkTrpcClient {
  return createNodeTrpcClient({ baseUrl: apiUrl, token }) as unknown as SdkTrpcClient;
}

// ---------------------------------------------------------------------------
// AbadgeUserClient — user session token operations
// ---------------------------------------------------------------------------

/**
 * SDK client for user-facing operations authenticated with a session token.
 *
 * Provides vault management, item CRUD, agent registration, permission
 * management, and audit log access. All methods throw {@link AbadgeApiError}
 * on failure with a typed {@link ErrorCode} code.
 *
 * @example
 * ```typescript
 * import { AbadgeUserClient } from "@abadge/sdk";
 *
 * const client = new AbadgeUserClient({
 *   apiUrl: "https://api.abadge.dev",
 *   sessionToken: "user_session_token",
 * });
 *
 * const { agents } = await client.listAgents();
 * ```
 */
export class AbadgeUserClient {
  /** @internal */
  protected readonly client: SdkTrpcClient;

  constructor(config: AbadgeUserClientConfig | AbadgeClientConfig) {
    const token = "sessionToken" in config ? config.sessionToken : config.token;
    this.client = buildTrpcClient(config.apiUrl, token);
  }

  // -- Vault ----------------------------------------------------------------

  /**
   * Initialize the user's vault. Called once after account creation.
   *
   * @param data - Wrapped root key, KDF salt, and Argon2id parameters
   * @returns The new vault's ID
   * @throws {AbadgeApiError} VAULT_ALREADY_EXISTS
   */
  async bootstrapVault(data: BootstrapVaultInput): Promise<{ id: string }> {
    return call(() => this.client.vault.bootstrap.mutate(data), "Failed to bootstrap vault");
  }

  /**
   * Retrieve vault metadata (wrapped root key, KDF params, key version).
   *
   * @returns The vault object
   * @throws {AbadgeApiError} VAULT_NOT_FOUND
   */
  async getVault(): Promise<VaultResult> {
    return call(() => this.client.vault.get.query(), "Failed to fetch vault");
  }

  /**
   * Re-wrap the root key with a new password. The server never sees the unwrapped key.
   *
   * @param data - New wrapped root key, KDF salt, and Argon2id parameters
   * @throws {AbadgeApiError} VAULT_NOT_FOUND
   */
  async changePassword(data: ChangePasswordInput): Promise<SuccessResult> {
    return call(() => this.client.vault.changePassword.mutate(data), "Failed to change password");
  }

  /**
   * Rotate the vault root key. All zero-knowledge items must be re-keyed atomically.
   *
   * @param data - New wrapped root key and a map of itemId to re-encrypted item keys
   * @returns The new key version number
   * @throws {AbadgeApiError} VAULT_NOT_FOUND
   */
  async rotateKey(data: RotateKeyInput): Promise<{ ok: boolean; keyVersion: number }> {
    return call(() => this.client.vault.rotateKey.mutate(data), "Failed to rotate key");
  }

  /**
   * Set or update the recovery key for the vault.
   *
   * @param data - Root key wrapped by the recovery key
   * @throws {AbadgeApiError} VAULT_NOT_FOUND
   */
  async setupRecovery(data: SetupRecoveryInput): Promise<SuccessResult> {
    return call(() => this.client.vault.setupRecovery.mutate(data), "Failed to set up recovery");
  }

  // -- Items ----------------------------------------------------------------

  /**
   * Create a new encrypted item. Accepts either zero-knowledge (client-encrypted)
   * or server-managed (plaintext payload encrypted by the server) input.
   *
   * @param data - Item data discriminated by storageMode
   * @returns The new item's ID
   * @throws {AbadgeApiError} VALIDATION_ERROR
   */
  async createItem(data: CreateItemInput): Promise<{ id: string }> {
    return call(() => this.client.items.create.mutate(data), "Failed to create item");
  }

  /**
   * List all items for the current user (metadata only, no encrypted data).
   *
   * @returns Array of item summaries
   */
  async listItems(): Promise<ItemListResult> {
    return call(() => this.client.items.list.query(), "Failed to list items");
  }

  /**
   * Retrieve a single item with full detail. For zero-knowledge items, includes
   * the encrypted blob; for server-managed items, includes metadata only.
   *
   * @param id - Item ID
   * @throws {AbadgeApiError} ITEM_NOT_FOUND
   */
  async getItem(id: string): Promise<ItemResult> {
    return call(() => this.client.items.get.query({ itemId: id }), "Failed to fetch item");
  }

  /**
   * Update an item with optimistic concurrency. The contentVersion in the data
   * must match the current version or the update is rejected.
   *
   * @param id - Item ID
   * @param data - Updated item data (includes required contentVersion)
   * @returns The new content version number
   * @throws {AbadgeApiError} ITEM_NOT_FOUND, STALE_VERSION
   */
  async updateItem(
    id: string,
    data: UpdateItemInput,
  ): Promise<{ ok: boolean; contentVersion: number }> {
    return call(
      () => this.client.items.update.mutate({ itemId: id, data }),
      "Failed to update item",
    );
  }

  /**
   * Decrypt and return the plaintext of a server-managed item owned by the
   * current user. Zero-knowledge items cannot be revealed server-side.
   *
   * @param id - Item ID
   * @returns The decrypted item payload
   * @throws {AbadgeApiError} BAD_REQUEST (non-server-managed), ITEM_NOT_FOUND
   */
  async ownerReveal(id: string): Promise<RevealAccessResponse> {
    return call(
      () => this.client.items.ownerReveal.mutate({ itemId: id }),
      "Failed to reveal item",
    );
  }

  /**
   * Soft-delete an item. The item is marked as deleted but preserved for audit integrity.
   *
   * @param id - Item ID
   * @throws {AbadgeApiError} ITEM_NOT_FOUND
   */
  async deleteItem(id: string): Promise<SuccessResult> {
    return call(() => this.client.items.delete.mutate({ itemId: id }), "Failed to delete item");
  }

  // -- Agents ---------------------------------------------------------------

  /**
   * Register a new agent and receive a one-time API key.
   *
   * The API key is shown exactly once in the response and is never retrievable again.
   * Store it securely immediately after creation.
   *
   * @param data - Agent kind, name, and optional metadata
   * @returns The created agent and its one-time API key
   * @throws {AbadgeApiError} VALIDATION_ERROR
   */
  async createAgent(data: CreateAgentInput): Promise<AgentWithKey> {
    return call(() => this.client.agents.create.mutate(data), "Failed to create agent");
  }

  /**
   * List all agents for the current user.
   *
   * @returns Array of agents (without API keys)
   */
  async listAgents(): Promise<AgentListResult> {
    return call(() => this.client.agents.list.query(), "Failed to list agents");
  }

  /**
   * Rotate an agent's API key. The old key is invalidated immediately.
   * The new key is shown exactly once and is never retrievable again.
   *
   * @param id - Agent ID
   * @returns The new API key and key prefix
   * @throws {AbadgeApiError} AGENT_NOT_FOUND
   */
  async rotateAgent(id: string): Promise<AgentRotateResult> {
    return call(() => this.client.agents.rotate.mutate({ agentId: id }), "Failed to rotate agent");
  }

  /**
   * Revoke an agent. The agent can no longer authenticate or access any items.
   * This action is irreversible.
   *
   * @param id - Agent ID
   * @throws {AbadgeApiError} AGENT_NOT_FOUND
   */
  async revokeAgent(id: string): Promise<SuccessResult> {
    return call(() => this.client.agents.revoke.mutate({ agentId: id }), "Failed to revoke agent");
  }

  // -- Permissions ----------------------------------------------------------

  /**
   * Grant a capability to an agent for a specific item.
   *
   * @param data - Agent ID, item ID, capability, and optional expiration
   * @returns The created permission
   * @throws {AbadgeApiError} AGENT_NOT_FOUND, ITEM_NOT_FOUND, INVALID_CAPABILITY
   */
  async createPermission(data: CreatePermissionInput): Promise<PermissionResult> {
    return call(() => this.client.permissions.create.mutate(data), "Failed to create permission");
  }

  /**
   * List permissions, optionally filtered by agent and/or item.
   *
   * @param filters - Optional agentId and/or itemId filters
   * @returns Array of permissions
   */
  async listPermissions(filters: PermissionFilters = {}): Promise<PermissionListResult> {
    return call(() => this.client.permissions.list.query(filters), "Failed to list permissions");
  }

  /**
   * Revoke a permission. The agent immediately loses the granted capability.
   *
   * @param id - Permission ID
   * @throws {AbadgeApiError} PERMISSION_NOT_FOUND
   */
  async revokePermission(id: string): Promise<SuccessResult> {
    return call(
      () => this.client.permissions.revoke.mutate({ permissionId: id }),
      "Failed to revoke permission",
    );
  }

  // -- Audit ----------------------------------------------------------------

  /**
   * Query the audit log with optional filters and cursor-based pagination.
   *
   * @param filters - Optional filters (eventType, result, agentId, itemId, cursor, limit)
   * @returns Paginated audit entries and a nextCursor for the next page (null if no more pages)
   */
  async getAudit(filters: AuditFilters = {}): Promise<AuditListResult> {
    return call(() => this.client.audit.list.query(filters), "Failed to fetch audit log");
  }
}

// ---------------------------------------------------------------------------
// AbadgeAgentClient — agent API key / session token operations
// ---------------------------------------------------------------------------

/**
 * SDK client for agent-facing operations authenticated with an API key or
 * session token (prefixed `abl_`, `abg_`, or `abs_`).
 *
 * Provides secret access methods and self-identification. All methods throw
 * {@link AbadgeApiError} on failure with a typed {@link ErrorCode} code.
 *
 * @example
 * ```typescript
 * import { AbadgeAgentClient } from "@abadge/sdk";
 *
 * const agent = new AbadgeAgentClient({
 *   apiUrl: "https://api.abadge.dev",
 *   apiKey: "abl_xxxxxxxxxxxx",
 * });
 *
 * const secret = await agent.accessReveal("item_id");
 * ```
 */
export class AbadgeAgentClient {
  /** @internal */
  protected readonly client: SdkTrpcClient;

  constructor(config: AbadgeAgentClientConfig | AbadgeClientConfig) {
    const token = "apiKey" in config ? config.apiKey : config.token;
    this.client = buildTrpcClient(config.apiUrl, token);
  }

  // -- Self -----------------------------------------------------------------

  /**
   * Retrieve the currently authenticated agent's own record.
   *
   * @returns The agent record
   * @throws {AbadgeApiError} UNAUTHORIZED
   */
  async getCurrentAgent(): Promise<AgentResult> {
    return call(() => this.client.agents.self.query(), "Failed to fetch agent");
  }

  // -- Access ---------------------------------------------------------------

  /**
   * Read the encrypted blob of a zero-knowledge item for local decryption.
   * Requires `read_ciphertext` permission. Local agents only. ZK items only.
   *
   * Every access attempt (allowed or denied) is recorded in the audit log.
   *
   * @param itemId - Item ID
   * @returns Encrypted item key, ciphertext, and crypto version
   * @throws {AbadgeApiError} FORBIDDEN, PERMISSION_DENIED, PERMISSION_EXPIRED, ITEM_NOT_FOUND
   */
  async accessCiphertext(itemId: string): Promise<CiphertextAccessResponse> {
    return call(
      () => this.client.access.ciphertext.mutate({ itemId }),
      "Failed to access ciphertext",
    );
  }

  /**
   * Decrypt and return the plaintext of a server-managed item.
   * Requires `reveal_plaintext` permission. Server-managed items only.
   *
   * This is a security-sensitive operation: the server decrypts the item and
   * returns plaintext. Every access attempt is recorded in the audit log.
   *
   * @param itemId - Item ID
   * @returns The decrypted item payload
   * @throws {AbadgeApiError} BAD_REQUEST, PERMISSION_DENIED, PERMISSION_EXPIRED, ITEM_NOT_FOUND
   */
  async accessReveal(itemId: string): Promise<RevealAccessResponse> {
    return call(() => this.client.access.reveal.mutate({ itemId }), "Failed to reveal item");
  }

  /**
   * Request item data for local injection (env variable or temp file).
   * Requires `mount_env` or `mount_file` permission. Local agents only.
   *
   * For ZK items, returns the encrypted blob for local decryption.
   * For server-managed items, returns the decrypted payload.
   * Every access attempt is recorded in the audit log.
   *
   * @param itemId - Item ID
   * @param mountType - Injection method: "env" for environment variable, "file" for temp file
   * @returns Item data discriminated by storageMode
   * @throws {AbadgeApiError} FORBIDDEN, PERMISSION_DENIED, PERMISSION_EXPIRED, ITEM_NOT_FOUND
   */
  async accessMount(itemId: string, mountType: "env" | "file"): Promise<MountAccessResponse> {
    return call(
      () => this.client.access.mount.mutate({ itemId, mountType }),
      "Failed to access mount payload",
    );
  }
}

// ---------------------------------------------------------------------------
// AbadgeClient — backward-compatible alias
// ---------------------------------------------------------------------------

/**
 * Backward-compatible SDK client that combines user and agent operations.
 *
 * @deprecated Use {@link AbadgeUserClient} for user operations or
 * {@link AbadgeAgentClient} for agent operations. This class remains for
 * backward compatibility and will be removed in a future major version.
 *
 * @example
 * ```typescript
 * import { AbadgeClient } from "@abadge/sdk";
 *
 * const client = new AbadgeClient({
 *   apiUrl: "https://api.abadge.dev",
 *   token: "session_token_or_api_key",
 * });
 * ```
 */
export class AbadgeClient extends AbadgeUserClient {
  /**
   * Retrieve the currently authenticated agent's own record.
   * Only works when the client was constructed with an agent API key.
   *
   * @returns The agent record
   * @throws {AbadgeApiError} UNAUTHORIZED
   */
  async getCurrentAgent(): Promise<AgentResult> {
    return call(() => this.client.agents.self.query(), "Failed to fetch agent");
  }

  /**
   * Read the encrypted blob of a zero-knowledge item for local decryption.
   * @see {@link AbadgeAgentClient.accessCiphertext}
   */
  async accessCiphertext(itemId: string): Promise<CiphertextAccessResponse> {
    return call(
      () => this.client.access.ciphertext.mutate({ itemId }),
      "Failed to access ciphertext",
    );
  }

  /**
   * Decrypt and return the plaintext of a server-managed item.
   * @see {@link AbadgeAgentClient.accessReveal}
   */
  async accessReveal(itemId: string): Promise<RevealAccessResponse> {
    return call(() => this.client.access.reveal.mutate({ itemId }), "Failed to reveal item");
  }

  /**
   * Request item data for local injection (env variable or temp file).
   * @see {@link AbadgeAgentClient.accessMount}
   */
  async accessMount(itemId: string, mountType: "env" | "file"): Promise<MountAccessResponse> {
    return call(
      () => this.client.access.mount.mutate({ itemId, mountType }),
      "Failed to access mount payload",
    );
  }

  async createOperatorToken(data: CreateOperatorTokenInput): Promise<OperatorTokenCreateResult> {
    return call(
      () => this.client.auth.createOperatorToken.mutate(data),
      "Failed to create operator token",
    );
  }

  async listOperatorTokens(): Promise<OperatorTokenListResult> {
    return call(
      () => this.client.auth.listOperatorTokens.query(),
      "Failed to list operator tokens",
    );
  }

  async revokeOperatorToken(tokenId: string): Promise<SuccessResult> {
    return call(
      () => this.client.auth.revokeOperatorToken.mutate({ tokenId }),
      "Failed to revoke operator token",
    );
  }
}

// Re-export ErrorCode for SDK consumers
export type { ErrorCode } from "@abadge/core";

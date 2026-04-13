import type { ErrorCode } from "@abadge/core";
import { AbadgeApiError } from "./errors";
import { createNodeTrpcClient } from "./trpc";
import type {
  AgentBootstrapTokenResult,
  AgentChallengeResult,
  AgentEnrollmentResult,
  AgentListResult,
  AgentResult,
  AgentRotateResult,
  AgentSessionResult,
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

/**
 * Minimal JSON Web Key representation for an Ed25519 private key.
 * Matches the `JsonWebKey` shape from the Web Crypto API without requiring DOM lib.
 */
export interface Ed25519PrivateKeyJwk {
  kty: string;
  crv?: string;
  x?: string;
  d?: string;
  [key: string]: unknown;
}

/** Keypair-based session auth for agents (preferred). */
export interface AbadgeAgentKeypairConfig {
  /** API endpoint URL (no trailing slash). */
  apiUrl: string;
  /** Agent ID registered in Abadge. */
  agentId: string;
  /** Ed25519 private key (CryptoKey, JWK object, or JSON-serialized JWK string). */
  privateKey: CryptoKey | Ed25519PrivateKeyJwk | string;
}

/** Legacy API key auth for agents. */
export interface AbadgeAgentApiKeyConfig {
  /** API endpoint URL (no trailing slash). */
  apiUrl: string;
  /** Agent API key (prefixed `abl_`, `abg_`) or session token (prefixed `abs_`). */
  apiKey: string;
}

/** Configuration for agent SDK clients. Supports keypair or API key auth. */
export type AbadgeAgentClientConfig = AbadgeAgentKeypairConfig | AbadgeAgentApiKeyConfig;

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
  auth: {
    createChallenge: TrpcMutation<{ agentId: string }, AgentChallengeResult>;
    exchangeSession: TrpcMutation<
      { agentId: string; challengeId: string; challenge: string; signature: string },
      AgentSessionResult
    >;
    enroll: TrpcMutation<{ bootstrapToken: string; publicKey: string }, AgentEnrollmentResult>;
    issueBootstrapToken: TrpcMutation<{ agentId: string }, AgentBootstrapTokenResult>;
  };
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
    reveal: TrpcMutation<{ itemId: string; field?: string }, RevealAccessResponse>;
    mount: TrpcMutation<
      { itemId: string; mountType: "env" | "file"; field?: string },
      MountAccessResponse
    >;
  };
  audit: {
    list: TrpcQuery<AuditFilters, AuditListResult>;
  };
  profiles: {
    create: TrpcMutation<
      { orgId: string; name: string; description?: string; storageMode?: string },
      { id: string }
    >;
    list: TrpcQuery<{ orgId: string }, unknown>;
    get: TrpcQuery<{ profileId: string }, unknown>;
    bootstrap: TrpcMutation<{ profileId: string } & BootstrapVaultInput, { id: string }>;
    changePassword: TrpcMutation<{ profileId: string } & ChangePasswordInput, SuccessResult>;
    setupRecovery: TrpcMutation<{ profileId: string } & SetupRecoveryInput, SuccessResult>;
    rotateKey: TrpcMutation<
      { profileId: string } & RotateKeyInput,
      { ok: boolean; keyVersion: number }
    >;
    delete: TrpcMutation<{ profileId: string }, SuccessResult>;
  };
  organizations: {
    create: TrpcMutation<
      { name: string; slug?: string },
      { id: string; name: string; slug: string }
    >;
    list: TrpcQueryWithoutInput<{
      organizations: Array<{ id: string; name: string; slug: string; role: string }>;
    }>;
    get: TrpcQuery<{ orgId: string }, unknown>;
    update: TrpcMutation<{ orgId: string; name?: string }, SuccessResult>;
    delete: TrpcMutation<{ orgId: string }, SuccessResult>;
    members: {
      list: TrpcQuery<{ orgId: string }, unknown>;
      invite: TrpcMutation<{ orgId: string; role?: string }, { ok: boolean; invitationId: string; token: string }>;
      getInviteInfo: TrpcQuery<{ token: string }, { invitationId: string; organizationName: string; organizationSlug: string; role: string; expiresAt: string; inviterUserId: string }>;
      acceptInvite: TrpcMutation<{ token: string }, { ok: boolean; organizationId: string; organizationName: string; organizationSlug: string }>;
      revokeInvite: TrpcMutation<{ orgId: string; invitationId: string }, SuccessResult>;
      remove: TrpcMutation<{ orgId: string; userId: string }, SuccessResult>;
      updateRole: TrpcMutation<{ orgId: string; userId: string; role: string }, SuccessResult>;
    };
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

/** Build a tRPC client without auth (for keypair-based pre-auth challenge requests). */
function buildUnauthTrpcClient(apiUrl: string): SdkTrpcClient {
  return createNodeTrpcClient({ baseUrl: apiUrl }) as unknown as SdkTrpcClient;
}

function toBase64url(bytes: ArrayBuffer): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function parseJwkString(raw: string): Ed25519PrivateKeyJwk {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("privateKey string must be a JSON object (Ed25519 JWK)");
  }
  return parsed as Ed25519PrivateKeyJwk;
}

async function resolvePrivateKey(
  privateKey: CryptoKey | Ed25519PrivateKeyJwk | string,
): Promise<CryptoKey> {
  if (privateKey instanceof CryptoKey) {
    return privateKey;
  }
  if (typeof privateKey === "string") {
    return crypto.subtle.importKey(
      "jwk",
      parseJwkString(privateKey) as never,
      { name: "Ed25519" },
      false,
      ["sign"],
    );
  }
  return crypto.subtle.importKey("jwk", privateKey as never, { name: "Ed25519" }, false, ["sign"]);
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

  /**
   * Issue a one-time bootstrap token for a public-key agent that has not yet enrolled.
   * The token is shown exactly once and expires after 10 minutes.
   *
   * @param agentId - Agent ID
   * @returns The bootstrap token (prefix `abe_`) and expiration
   * @throws {AbadgeApiError} AGENT_NOT_FOUND, AGENT_ALREADY_ENROLLED
   */
  async issueBootstrapToken(agentId: string): Promise<AgentBootstrapTokenResult> {
    return call(
      () => this.client.auth.issueBootstrapToken.mutate({ agentId }),
      "Failed to issue bootstrap token",
    );
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

  // -- Organizations --------------------------------------------------------

  /**
   * Create a new organization.
   *
   * @param data - Organization name and optional slug
   * @returns The created organization
   */
  async createOrganization(data: {
    name: string;
    slug?: string;
  }): Promise<{ id: string; name: string; slug: string }> {
    return call(
      () => this.client.organizations.create.mutate(data),
      "Failed to create organization",
    );
  }

  /**
   * List organizations the current user belongs to.
   */
  async listOrganizations(): Promise<{
    organizations: Array<{ id: string; name: string; slug: string; role: string }>;
  }> {
    return call(() => this.client.organizations.list.query(), "Failed to list organizations");
  }

  /**
   * Get a specific organization by ID.
   *
   * @param orgId - Organization ID
   */
  async getOrganization(orgId: string): Promise<unknown> {
    return call(
      () => this.client.organizations.get.query({ orgId }),
      "Failed to fetch organization",
    );
  }

  /**
   * Update organization metadata.
   *
   * @param orgId - Organization ID
   * @param data - Fields to update
   */
  async updateOrganization(orgId: string, data: { name?: string }): Promise<SuccessResult> {
    return call(
      () => this.client.organizations.update.mutate({ orgId, ...data }),
      "Failed to update organization",
    );
  }

  /**
   * Delete an organization and all its resources.
   *
   * @param orgId - Organization ID
   */
  async deleteOrganization(orgId: string): Promise<SuccessResult> {
    return call(
      () => this.client.organizations.delete.mutate({ orgId }),
      "Failed to delete organization",
    );
  }

  /**
   * List members of an organization.
   *
   * @param orgId - Organization ID
   */
  async listMembers(orgId: string): Promise<unknown> {
    return call(
      () => this.client.organizations.members.list.query({ orgId }),
      "Failed to list members",
    );
  }

  /**
   * Create a link-based invite for an organization.
   *
   * @param orgId - Organization ID
   * @param data - Role for the invited member
   */
  async inviteMember(
    orgId: string,
    data: { role?: string },
  ): Promise<{ ok: boolean; invitationId: string; token: string }> {
    return call(
      () => this.client.organizations.members.invite.mutate({ orgId, ...data }),
      "Failed to create invite",
    );
  }

  async getInviteInfo(
    token: string,
  ): Promise<{ invitationId: string; organizationName: string; organizationSlug: string; role: string; expiresAt: string; inviterUserId: string }> {
    return call(
      () => this.client.organizations.members.getInviteInfo.query({ token }),
      "Failed to get invite info",
    );
  }

  async acceptInvite(token: string): Promise<{ ok: boolean; organizationId: string; organizationName: string; organizationSlug: string }> {
    return call(
      () => this.client.organizations.members.acceptInvite.mutate({ token }),
      "Failed to accept invite",
    );
  }

  async revokeInvite(orgId: string, invitationId: string): Promise<SuccessResult> {
    return call(
      () => this.client.organizations.members.revokeInvite.mutate({ orgId, invitationId }),
      "Failed to revoke invite",
    );
  }

  /**
   * Remove a member from an organization.
   *
   * @param orgId - Organization ID
   * @param userId - User ID to remove
   */
  async removeMember(orgId: string, userId: string): Promise<SuccessResult> {
    return call(
      () => this.client.organizations.members.remove.mutate({ orgId, userId }),
      "Failed to remove member",
    );
  }

  /**
   * Update a member's role in an organization.
   *
   * @param orgId - Organization ID
   * @param userId - User ID
   * @param role - New role
   */
  async updateMemberRole(orgId: string, userId: string, role: string): Promise<SuccessResult> {
    return call(
      () => this.client.organizations.members.updateRole.mutate({ orgId, userId, role }),
      "Failed to update member role",
    );
  }

  // -- Profiles -------------------------------------------------------------

  /**
   * Create a new profile in an organization.
   *
   * @param data - Profile data including orgId, name, and optional fields
   * @returns The new profile's ID
   */
  async createProfile(data: {
    orgId: string;
    name: string;
    description?: string;
    storageMode?: string;
  }): Promise<{ id: string }> {
    return call(() => this.client.profiles.create.mutate(data), "Failed to create profile");
  }

  /**
   * List profiles in an organization.
   *
   * @param orgId - Organization ID
   */
  async listProfiles(orgId: string): Promise<unknown> {
    return call(() => this.client.profiles.list.query({ orgId }), "Failed to list profiles");
  }

  /**
   * Get a specific profile.
   *
   * @param profileId - Profile ID
   */
  async getProfile(profileId: string): Promise<unknown> {
    return call(() => this.client.profiles.get.query({ profileId }), "Failed to fetch profile");
  }

  /**
   * Bootstrap a profile vault.
   *
   * @param profileId - Profile ID
   * @param data - Vault bootstrap data
   */
  async bootstrapProfile(profileId: string, data: BootstrapVaultInput): Promise<{ id: string }> {
    return call(
      () => this.client.profiles.bootstrap.mutate({ profileId, ...data }),
      "Failed to bootstrap profile",
    );
  }

  /**
   * Change the password for a profile.
   *
   * @param profileId - Profile ID
   * @param data - New password data
   */
  async changeProfilePassword(
    profileId: string,
    data: ChangePasswordInput,
  ): Promise<SuccessResult> {
    return call(
      () => this.client.profiles.changePassword.mutate({ profileId, ...data }),
      "Failed to change profile password",
    );
  }

  /**
   * Set up recovery for a profile.
   *
   * @param profileId - Profile ID
   * @param data - Recovery setup data
   */
  async setupProfileRecovery(profileId: string, data: SetupRecoveryInput): Promise<SuccessResult> {
    return call(
      () => this.client.profiles.setupRecovery.mutate({ profileId, ...data }),
      "Failed to set up profile recovery",
    );
  }

  /**
   * Rotate a profile's encryption key.
   *
   * @param profileId - Profile ID
   * @param data - Key rotation data
   */
  async rotateProfileKey(
    profileId: string,
    data: RotateKeyInput,
  ): Promise<{ ok: boolean; keyVersion: number }> {
    return call(
      () => this.client.profiles.rotateKey.mutate({ profileId, ...data }),
      "Failed to rotate profile key",
    );
  }

  /**
   * Delete a profile.
   *
   * @param profileId - Profile ID
   */
  async deleteProfile(profileId: string): Promise<SuccessResult> {
    return call(
      () => this.client.profiles.delete.mutate({ profileId }),
      "Failed to delete profile",
    );
  }
}

// ---------------------------------------------------------------------------
// AbadgeAgentClient — agent API key / session token / keypair operations
// ---------------------------------------------------------------------------

/**
 * SDK client for agent-facing operations. Supports two auth modes:
 * - **Keypair auth** (preferred): Ed25519 session exchange with automatic refresh.
 *   Call {@link connect} before using access methods.
 * - **API key auth**: Static API key (`abl_`, `abg_`, or `abs_` prefix).
 *
 * All methods throw {@link AbadgeApiError} on failure with a typed
 * {@link ErrorCode} code.
 *
 * @example API key auth
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
 *
 * @example Keypair auth
 * ```typescript
 * const agent = new AbadgeAgentClient({
 *   apiUrl: "https://api.abadge.dev",
 *   agentId: "agent_id",
 *   privateKey: ed25519PrivateKey,
 * });
 * await agent.connect();
 * const secret = await agent.accessReveal("item_id");
 * ```
 */
export class AbadgeAgentClient {
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly config: AbadgeAgentClientConfig | AbadgeClientConfig;

  /** @internal */
  protected client: SdkTrpcClient;

  constructor(config: AbadgeAgentClientConfig | AbadgeClientConfig) {
    this.config = config;
    if ("apiKey" in config) {
      this.client = buildTrpcClient(config.apiUrl, config.apiKey);
    } else if ("token" in config) {
      this.client = buildTrpcClient(config.apiUrl, config.token);
    } else {
      // Keypair config — build an unauth client; connect() will set the token
      this.client = buildUnauthTrpcClient(config.apiUrl);
      // Fail fast: validate string keys at construction time rather than at connect()
      if (typeof config.privateKey === "string") {
        parseJwkString(config.privateKey);
      }
    }
  }

  /**
   * For keypair-auth agents: performs Ed25519 session exchange and starts the
   * background T-2 minute refresh loop. Must be called before using access methods.
   * For API-key agents: no-op (session is implicit).
   */
  async connect(): Promise<void> {
    if (!("agentId" in this.config)) {
      return;
    }

    const { agentId, privateKey, apiUrl } = this.config;

    const unauthClient = buildUnauthTrpcClient(apiUrl);
    let challengeResult: AgentChallengeResult;
    try {
      challengeResult = await unauthClient.auth.createChallenge.mutate({ agentId });
    } catch (error) {
      throw AbadgeApiError.fromUnknown(error, "Failed to create agent challenge");
    }

    const { challengeId, challenge } = challengeResult;
    const key = await resolvePrivateKey(privateKey);
    const encoder = new TextEncoder();
    const signatureBytes = await crypto.subtle.sign("Ed25519", key, encoder.encode(challenge));
    const signature = toBase64url(signatureBytes);

    let sessionResult: AgentSessionResult;
    try {
      sessionResult = await unauthClient.auth.exchangeSession.mutate({
        agentId,
        challengeId,
        challenge,
        signature,
      });
    } catch (error) {
      throw AbadgeApiError.fromUnknown(error, "Failed to exchange agent session");
    }

    const { token: sessionToken, expiresAt } = sessionResult.session;
    this.client = buildTrpcClient(apiUrl, sessionToken);

    // Schedule refresh at T-2 minutes before expiry
    const expiresMs = new Date(expiresAt).getTime();
    const refreshDelay = Math.max(0, expiresMs - Date.now() - 2 * 60 * 1000);
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.connect().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[AbadgeAgentClient] Session refresh failed: ${msg}. Retrying in 30s...`);
        this.refreshTimer = setTimeout(() => {
          this.connect().catch((retryErr: unknown) => {
            const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            console.error(`[AbadgeAgentClient] Session refresh retry failed: ${retryMsg}`);
          });
        }, 30_000);
      });
    }, refreshDelay);
  }

  /**
   * Stops the background refresh loop. Safe to call multiple times.
   */
  disconnect(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  // -- Enrollment -----------------------------------------------------------

  /**
   * Enroll a public-key agent using a one-time bootstrap token.
   * The agent's Ed25519 public key is registered with the server.
   *
   * @param bootstrapToken - One-time bootstrap token (prefix `abe_`)
   * @param publicKey - Base64url-encoded Ed25519 public key
   * @returns Enrollment confirmation with agent ID and enrolled timestamp
   * @throws {AbadgeApiError} BOOTSTRAP_TOKEN_INVALID, BOOTSTRAP_TOKEN_EXPIRED
   */
  async enroll(bootstrapToken: string, publicKey: string): Promise<AgentEnrollmentResult> {
    return call(
      () => this.client.auth.enroll.mutate({ bootstrapToken, publicKey }),
      "Failed to enroll agent",
    );
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

  // -- Items (read-only) ----------------------------------------------------

  /**
   * List all items visible to this agent (metadata only, no encrypted data).
   *
   * @returns Array of item summaries
   */
  async listItems(): Promise<ItemListResult> {
    return call(() => this.client.items.list.query(), "Failed to list items");
  }

  /**
   * Retrieve a single item's metadata and encrypted content.
   * Only works when the agent session also carries user-level privileges.
   * If called with an agent-only API key, throws {@link AbadgeApiError} with
   * code `UNAUTHORIZED` — the caller should fall back to the `access*` methods.
   *
   * @param id - Item ID
   * @throws {AbadgeApiError} ITEM_NOT_FOUND, UNAUTHORIZED
   */
  async getItem(id: string): Promise<ItemResult> {
    return call(() => this.client.items.get.query({ itemId: id }), "Failed to fetch item");
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
   * @param field - Optional specific field name to return (for multi-field items)
   * @returns The decrypted item payload
   * @throws {AbadgeApiError} BAD_REQUEST, PERMISSION_DENIED, PERMISSION_EXPIRED, ITEM_NOT_FOUND
   */
  async accessReveal(itemId: string, field?: string): Promise<RevealAccessResponse> {
    return call(
      () => this.client.access.reveal.mutate({ itemId, ...(field ? { field } : {}) }),
      "Failed to reveal item",
    );
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
   * @param field - Optional specific field name to return (for multi-field items)
   * @returns Item data discriminated by storageMode
   * @throws {AbadgeApiError} FORBIDDEN, PERMISSION_DENIED, PERMISSION_EXPIRED, ITEM_NOT_FOUND
   */
  async accessMount(
    itemId: string,
    mountType: "env" | "file",
    field?: string,
  ): Promise<MountAccessResponse> {
    return call(
      () => this.client.access.mount.mutate({ itemId, mountType, ...(field ? { field } : {}) }),
      "Failed to access mount payload",
    );
  }
}

// Re-export ErrorCode for SDK consumers
export type { ErrorCode } from "@abadge/core";

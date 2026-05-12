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
  BulkMountEnvResponse,
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
  ProfileUseAccessResponse,
  ReadAccessResponse,
  RedeemMountResponse,
  RevealAccessResponse,
  RotateKeyInput,
  SetupRecoveryInput,
  SuccessResult,
  UpdateItemInput,
  UseAccessResponse,
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
  /** Active organization ID. Sent as X-Abadge-Org-Id header for org-scoped requests. */
  orgId?: string;
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

/**
 * Schedules `callback` to run after `delayMs` milliseconds and returns a timer
 * handle compatible with `clearTimeout`. Defaults to `setTimeout`; test seams
 * may supply a synchronous or mock scheduler to exercise retry logic without
 * real timers.
 */
export type AbadgeScheduler = (
  callback: () => void,
  delayMs: number,
) => ReturnType<typeof setTimeout>;

/** Keypair-based session auth for agents (preferred). */
export interface AbadgeAgentKeypairConfig {
  /** API endpoint URL (no trailing slash). */
  apiUrl: string;
  /** Agent ID registered in Abadge. */
  agentId: string;
  /** Ed25519 private key (CryptoKey, JWK object, or JSON-serialized JWK string). */
  privateKey: CryptoKey | Ed25519PrivateKeyJwk | string;
  /**
   * Optional callback fired whenever a background session refresh attempt
   * fails. Receives the error and the 0-indexed attempt number. After all
   * attempts are exhausted, the client flips to `sessionExpired` and outgoing
   * API calls reject fast with `SESSION_REFRESH_FAILED`.
   */
  onSessionError?: (error: Error, attempt: number) => void;
  /**
   * Test seam: scheduler used for background refresh + retry timers. Defaults
   * to `setTimeout`. Production callers should not set this.
   * @internal
   */
  schedulerFn?: AbadgeScheduler;
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
  items: {
    create: TrpcMutation<CreateItemInput, { id: string }>;
    list: TrpcQueryWithoutInput<ItemListResult>;
    listForAgent: TrpcQueryWithoutInput<ItemListResult>;
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
    create: TrpcMutation<CreatePermissionInput, PermissionListResult>;
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
    bulkMountEnv: TrpcMutation<{ profileId: string }, BulkMountEnvResponse>;
    read: TrpcMutation<{ itemId: string; field?: string; purpose?: string }, ReadAccessResponse>;
    use: TrpcMutation<
      {
        itemId: string;
        delivery: "env" | "file";
        field?: string;
        envVarName?: string;
        purpose?: string;
      },
      UseAccessResponse
    >;
    useProfile: TrpcMutation<
      { profileId: string; delivery: "env" | "file"; purpose?: string },
      ProfileUseAccessResponse
    >;
    redeemMount: TrpcMutation<{ mountId: string }, RedeemMountResponse>;
  };
  audit: {
    list: TrpcQuery<AuditFilters, AuditListResult>;
    listForAgent: TrpcQuery<AuditFilters, AuditListResult>;
  };
  profiles: {
    create: TrpcMutation<
      { orgId: string; name: string; description?: string; storageMode?: string },
      {
        profile: {
          id: string;
          name: string;
          organizationId: string;
          storageMode: string;
          keyVersion: number;
          createdAt: string;
          updatedAt: string;
        };
      }
    >;
    list: TrpcQuery<
      { orgId: string },
      {
        profiles: Array<{
          id: string;
          name: string;
          storageMode: string;
          organizationId: string;
          keyVersion: number;
          createdAt: string;
          updatedAt: string;
        }>;
      }
    >;
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
      {
        organization: {
          id: string;
          name: string;
          slug: string;
          logo: string | null;
          createdAt: string;
        };
      }
    >;
    list: TrpcQueryWithoutInput<{
      organizations: Array<{
        id: string;
        name: string;
        slug: string;
        logo: string | null;
        createdAt: string;
        role: string;
        hasBootstrappedProfile: boolean;
      }>;
    }>;
    get: TrpcQuery<{ orgId: string }, unknown>;
    update: TrpcMutation<{ orgId: string; name?: string }, SuccessResult>;
    delete: TrpcMutation<{ orgId: string }, SuccessResult>;
    members: {
      list: TrpcQuery<
        { orgId: string },
        {
          members: Array<{
            id: string;
            userId: string;
            name: string;
            email: string;
            role: string;
            createdAt: string;
          }>;
        }
      >;
      invite: TrpcMutation<
        { orgId: string; role?: string },
        { ok: boolean; invitationId: string; token: string }
      >;
      getInviteInfo: TrpcQuery<
        { token: string },
        {
          organizationName: string;
          organizationSlug: string;
          role: string;
          expiresAt: string;
        }
      >;
      acceptInvite: TrpcMutation<
        { token: string },
        { ok: boolean; organizationId: string; organizationName: string; organizationSlug: string }
      >;
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

function buildTrpcClient(apiUrl: string, token: string, orgId?: string): SdkTrpcClient {
  return createNodeTrpcClient({ baseUrl: apiUrl, token, orgId }) as unknown as SdkTrpcClient;
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

  /**
   * §RM-PR4 — Namespaced API surface. Prefer these over the top-level
   * methods, which remain for one release and route through the same tRPC
   * paths.
   *
   * @example
   * ```typescript
   * const client = new AbadgeUserClient({ apiUrl, sessionToken });
   * const { organizations } = await client.orgs.list();
   * const { profiles } = await client.profiles.list(organizations[0].id);
   * const { items } = await client.items.list();
   * ```
   */
  readonly orgs: {
    create: (data: { name: string; slug?: string }) => Promise<{
      id: string;
      name: string;
      slug: string;
    }>;
    list: () => ReturnType<AbadgeUserClient["listOrganizations"]>;
    get: (orgId: string) => Promise<unknown>;
    update: (orgId: string, data: { name?: string }) => Promise<SuccessResult>;
    delete: (orgId: string) => Promise<SuccessResult>;
  };

  readonly profiles: {
    create: AbadgeUserClient["createProfile"];
    list: AbadgeUserClient["listProfiles"];
    get: AbadgeUserClient["getProfile"];
    update: (profileId: string, data: ChangePasswordInput) => Promise<SuccessResult>;
    delete: AbadgeUserClient["deleteProfile"];
  };

  readonly items: {
    create: AbadgeUserClient["createItem"];
    list: AbadgeUserClient["listItems"];
    get: AbadgeUserClient["getItem"];
    update: AbadgeUserClient["updateItem"];
    delete: AbadgeUserClient["deleteItem"];
  };

  readonly agents: {
    create: AbadgeUserClient["createAgent"];
    list: AbadgeUserClient["listAgents"];
    get: (agentId: string) => Promise<AgentResult>;
    update: (agentId: string) => Promise<AgentRotateResult>;
    delete: AbadgeUserClient["revokeAgent"];
  };

  readonly permissions: {
    create: AbadgeUserClient["createPermission"];
    list: AbadgeUserClient["listPermissions"];
    get: (permissionId: string) => Promise<unknown>;
    update: (permissionId: string) => Promise<SuccessResult>;
    delete: AbadgeUserClient["revokePermission"];
  };

  readonly audit: {
    list: AbadgeUserClient["getAudit"];
  };

  constructor(config: AbadgeUserClientConfig) {
    this.client = buildTrpcClient(config.apiUrl, config.sessionToken, config.orgId);

    // §RM-PR4 — namespaces delegate to the existing top-level methods so there
    // is exactly one implementation per route. The legacy methods stay on the
    // surface (marked @deprecated below) until the v0.6 removal.
    this.orgs = {
      create: (data) => this.createOrganization(data),
      list: () => this.listOrganizations(),
      get: (orgId) => this.getOrganization(orgId),
      update: (orgId, data) => this.updateOrganization(orgId, data),
      delete: (orgId) => this.deleteOrganization(orgId),
    };

    this.profiles = {
      create: (data) => this.createProfile(data),
      list: (orgId) => this.listProfiles(orgId),
      get: (profileId) => this.getProfile(profileId),
      // Profile metadata is largely immutable; "update" surfaces the password
      // change path which is the only post-creation mutation a user can do.
      update: (profileId, data) => this.changeProfilePassword(profileId, data),
      delete: (profileId) => this.deleteProfile(profileId),
    };

    this.items = {
      create: (data) => this.createItem(data),
      list: () => this.listItems(),
      get: (id) => this.getItem(id),
      update: (id, data) => this.updateItem(id, data),
      delete: (id) => this.deleteItem(id),
    };

    this.agents = {
      create: (data) => this.createAgent(data),
      list: () => this.listAgents(),
      // No tRPC procedure for fetching a single user-owned agent record by id
      // today; list-and-find is the documented path.
      get: async (agentId: string) => {
        const { agents } = await this.listAgents();
        const found = agents.find((a) => a.id === agentId);
        if (!found) {
          throw new AbadgeApiError(
            404,
            "AGENT_NOT_FOUND",
            `Agent ${agentId} not found`,
            "Confirm the agent ID and that the agent belongs to the active organization.",
          );
        }
        return { agent: found };
      },
      // "update" on an agent rotates its credential (the only mutation
      // exposed today). Returns the one-time rotated key.
      update: (agentId) => this.rotateAgent(agentId),
      delete: (agentId) => this.revokeAgent(agentId),
    };

    this.permissions = {
      create: (data) => this.createPermission(data),
      list: (filters?: PermissionFilters) => this.listPermissions(filters),
      // No standalone `permissions.get` procedure; list with filters covers it.
      get: async (permissionId: string) => {
        const { permissions } = await this.listPermissions();
        const found = permissions.find((p) => p.id === permissionId);
        if (!found) {
          throw new AbadgeApiError(
            404,
            "PERMISSION_NOT_FOUND",
            `Permission ${permissionId} not found`,
            "Confirm the permission ID is correct and still active.",
          );
        }
        return found;
      },
      // Permissions are immutable except for revocation; `update` is an alias
      // for `delete` so the CRUD shape stays uniform.
      update: (permissionId) => this.revokePermission(permissionId),
      delete: (permissionId) => this.revokePermission(permissionId),
    };

    this.audit = {
      list: (filters?: AuditFilters) => this.getAudit(filters),
    };
  }

  // -- Items ----------------------------------------------------------------

  /**
   * Create a new encrypted item. Accepts either zero-knowledge (client-encrypted)
   * or server-managed (plaintext payload encrypted by the server) input.
   *
   * @param data - Item data discriminated by storageMode
   * @returns The new item's ID
   * @throws {AbadgeApiError} VALIDATION_ERROR
   * @deprecated Use `client.items.create(data)` instead. Removal target: v0.6.
   */
  async createItem(data: CreateItemInput): Promise<{ id: string }> {
    return call(() => this.client.items.create.mutate(data), "Failed to create item");
  }

  /**
   * List all items for the current user (metadata only, no encrypted data).
   *
   * @returns Array of item summaries
   * @deprecated Use `client.items.list()` instead. Removal target: v0.6.
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
   * @deprecated Use `client.items.get(id)` instead. Removal target: v0.6.
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
   * @deprecated Use `client.items.update(id, data)` instead. Removal target: v0.6.
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
   * @deprecated Use `client.items.delete(id)` instead. Removal target: v0.6.
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
   * @deprecated Use `client.agents.create(data)` instead. Removal target: v0.6.
   */
  async createAgent(data: CreateAgentInput): Promise<AgentWithKey> {
    return call(() => this.client.agents.create.mutate(data), "Failed to create agent");
  }

  /**
   * List all agents for the current user.
   *
   * @returns Array of agents (without API keys)
   * @deprecated Use `client.agents.list()` instead. Removal target: v0.6.
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
   * @deprecated Use `client.agents.update(id)` instead. Removal target: v0.6.
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
   * @deprecated Use `client.agents.delete(id)` instead. Removal target: v0.6.
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
   * Grant one or more capabilities to an agent for a specific item.
   *
   * Supplying multiple capabilities is atomic: either every row lands or none
   * does. Duplicates are detected up-front, and the error envelope's `meta`
   * carries the full list of offending capabilities (`invalidCapabilities` or
   * `duplicateCapabilities`) so callers can recover precisely.
   *
   * @param data - Agent ID, item ID, capabilities (non-empty), and optional batch-wide expiration
   * @returns The created permission rows (one per capability)
   * @throws {AbadgeApiError} AGENT_NOT_FOUND, ITEM_NOT_FOUND,
   *   INVALID_CAPABILITY_LOCALITY, INVALID_CAPABILITY_STORAGE,
   *   PERMISSION_ALREADY_EXISTS
   * @deprecated Use `client.permissions.create(data)` instead. Removal target: v0.6.
   */
  async createPermission(data: CreatePermissionInput): Promise<PermissionListResult> {
    return call(() => this.client.permissions.create.mutate(data), "Failed to create permission");
  }

  /**
   * List permissions, optionally filtered by agent and/or item.
   *
   * @param filters - Optional agentId and/or itemId filters
   * @returns Array of permissions
   * @deprecated Use `client.permissions.list(filters)` instead. Removal target: v0.6.
   */
  async listPermissions(filters: PermissionFilters = {}): Promise<PermissionListResult> {
    return call(() => this.client.permissions.list.query(filters), "Failed to list permissions");
  }

  /**
   * Revoke a permission. The agent immediately loses the granted capability.
   *
   * @param id - Permission ID
   * @throws {AbadgeApiError} PERMISSION_NOT_FOUND
   * @deprecated Use `client.permissions.delete(id)` instead. Removal target: v0.6.
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
   * @deprecated Use `client.audit.list(filters)` instead. Removal target: v0.6.
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
   * @deprecated Use `client.orgs.create(data)` instead. Removal target: v0.6.
   */
  async createOrganization(data: {
    name: string;
    slug?: string;
  }): Promise<{ id: string; name: string; slug: string }> {
    const result = await call(
      () => this.client.organizations.create.mutate(data),
      "Failed to create organization",
    );
    return result.organization;
  }

  /**
   * List organizations the current user belongs to.
   * @deprecated Use `client.orgs.list()` instead. Removal target: v0.6.
   */
  async listOrganizations(): Promise<{
    organizations: Array<{
      id: string;
      name: string;
      slug: string;
      logo: string | null;
      createdAt: string;
      role: string;
      hasBootstrappedProfile: boolean;
    }>;
  }> {
    return call(() => this.client.organizations.list.query(), "Failed to list organizations");
  }

  /**
   * Get a specific organization by ID.
   *
   * @param orgId - Organization ID
   * @deprecated Use `client.orgs.get(orgId)` instead. Removal target: v0.6.
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
   * @deprecated Use `client.orgs.update(orgId, data)` instead. Removal target: v0.6.
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
   * @deprecated Use `client.orgs.delete(orgId)` instead. Removal target: v0.6.
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
  async listMembers(orgId: string): Promise<{
    members: Array<{
      id: string;
      userId: string;
      name: string;
      // null for callers whose role is below admin — the server withholds
      // teammates' email addresses to prevent org-internal PII enumeration.
      email: string | null;
      role: string;
      createdAt: string;
    }>;
  }> {
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

  async getInviteInfo(token: string): Promise<{
    organizationName: string;
    organizationSlug: string;
    role: string;
    expiresAt: string;
  }> {
    return call(
      () => this.client.organizations.members.getInviteInfo.query({ token }),
      "Failed to get invite info",
    );
  }

  async acceptInvite(token: string): Promise<{
    ok: boolean;
    organizationId: string;
    organizationName: string;
    organizationSlug: string;
  }> {
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
   * @deprecated Use `client.profiles.create(data)` instead. Removal target: v0.6.
   */
  async createProfile(data: {
    orgId: string;
    name: string;
    description?: string;
    storageMode?: string;
  }): Promise<{ id: string; name: string; storageMode: string }> {
    const result = await call(
      () => this.client.profiles.create.mutate(data),
      "Failed to create profile",
    );
    return result.profile;
  }

  /**
   * List profiles in an organization.
   *
   * @param orgId - Organization ID
   * @deprecated Use `client.profiles.list(orgId)` instead. Removal target: v0.6.
   */
  async listProfiles(orgId: string): Promise<{
    profiles: Array<{
      id: string;
      name: string;
      storageMode: string;
      organizationId: string;
      keyVersion: number;
      createdAt: string;
      updatedAt: string;
    }>;
  }> {
    return call(() => this.client.profiles.list.query({ orgId }), "Failed to list profiles");
  }

  /**
   * Get a specific profile.
   *
   * @param profileId - Profile ID
   * @deprecated Use `client.profiles.get(profileId)` instead. Removal target: v0.6.
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
   * @deprecated Use `client.profiles.delete(profileId)` instead. Removal target: v0.6.
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
/**
 * Bounded exponential backoff schedule for background session refresh retries.
 * 5 attempts total: 30s → 60s → 120s → 240s → 300s. After the final failure,
 * the client flips to `sessionExpired` and outgoing calls reject fast.
 * @internal
 */
export const REFRESH_RETRY_SCHEDULE_MS: readonly number[] = [
  30_000, 60_000, 120_000, 240_000, 300_000,
] as const;

export class AbadgeAgentClient {
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly config: AbadgeAgentClientConfig;
  private sessionExpired = false;
  private lastExpiresAtMs = 0;

  /** @internal */
  protected client: SdkTrpcClient;

  constructor(config: AbadgeAgentClientConfig) {
    this.config = config;
    if ("apiKey" in config) {
      this.client = buildTrpcClient(config.apiUrl, config.apiKey);
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
   *
   * Timer lifecycle: the refresh timer is `.unref()`'d so it does NOT keep the
   * Node/Bun event loop alive on its own. Long-lived consumers (MCP stdio,
   * HTTP servers, daemon sockets) stay alive via their own handles and the
   * refresh still fires. Short-lived consumers (CLI commands) exit cleanly
   * once their work finishes — without `.unref()` they would hang ~13 min
   * until the refresh fires. `disconnect()` remains the deterministic cleanup
   * path for tests and any caller that wants to force teardown.
   *
   * Retry behaviour: a background refresh failure triggers bounded exponential
   * backoff (see {@link REFRESH_RETRY_SCHEDULE_MS}). After all attempts fail
   * the client flips to `sessionExpired=true` and outgoing API calls reject
   * fast with `SESSION_REFRESH_FAILED` instead of flooding the server with
   * 401s. Calling `connect()` again resets the state and re-runs the exchange.
   */
  async connect(): Promise<void> {
    // Reset sessionExpired on every successful entry so disconnect()+connect()
    // recovery works cleanly. If the exchange below throws, this flag stays
    // false: the caller sees the error synchronously and decides what to do.
    this.sessionExpired = false;
    await this.exchangeSessionOnce();
    this.scheduleRefreshFromExpiry();
  }

  /**
   * Performs the two-step Ed25519 session exchange and updates the internal
   * tRPC client with the fresh session token. Does NOT schedule the next
   * refresh — that is the caller's responsibility. Throws on failure so both
   * the initial `connect()` caller and the background refresh can react.
   */
  private async exchangeSessionOnce(): Promise<void> {
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
    this.lastExpiresAtMs = new Date(expiresAt).getTime();
  }

  /** Schedule the next T-2min refresh based on the most recent session expiry. */
  private scheduleRefreshFromExpiry(): void {
    if (!("agentId" in this.config)) {
      return;
    }
    const refreshDelay = Math.max(0, this.lastExpiresAtMs - Date.now() - 2 * 60 * 1000);
    this.armTimer(refreshDelay, () => {
      void this.refreshOnce(0);
    });
  }

  /**
   * Run a single refresh attempt. On success, schedule the next T-2min
   * refresh (attempt counter implicitly resets: subsequent failures start
   * over at 0). On failure, invoke `onSessionError`, log, and either
   * schedule the next retry from {@link REFRESH_RETRY_SCHEDULE_MS} or
   * flip to `sessionExpired` once all retries are exhausted.
   *
   * `attempt` is the 0-indexed failure counter: attempt 0 is the initial
   * T-2min refresh; attempts 1..N consume REFRESH_RETRY_SCHEDULE_MS[0..N-1].
   * Exhaustion fires after `REFRESH_RETRY_SCHEDULE_MS.length` retries have
   * all failed.
   */
  private async refreshOnce(attempt: number): Promise<void> {
    try {
      await this.exchangeSessionOnce();
      this.scheduleRefreshFromExpiry();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if ("agentId" in this.config) {
        this.config.onSessionError?.(error, attempt);
      }
      console.error(
        `[AbadgeAgentClient] Session refresh attempt ${attempt + 1} failed: ${error.message}`,
      );

      const retryIndex = attempt; // next retry delay to consume
      if (retryIndex >= REFRESH_RETRY_SCHEDULE_MS.length) {
        this.sessionExpired = true;
        console.error(
          `[AbadgeAgentClient] Session refresh exhausted after ${attempt + 1} attempts (initial + ${REFRESH_RETRY_SCHEDULE_MS.length} retries); client is now in sessionExpired state. Outgoing calls will reject with SESSION_REFRESH_FAILED.`,
        );
        return;
      }

      const delayMs = REFRESH_RETRY_SCHEDULE_MS[retryIndex] ?? 30_000;
      this.armTimer(delayMs, () => {
        void this.refreshOnce(attempt + 1);
      });
    }
  }

  /**
   * Replace the current refresh timer using the configured scheduler (default
   * `setTimeout`) and `.unref()` it if supported. Centralising timer creation
   * preserves the B1 event-loop-does-not-hang invariant for every refresh/retry.
   */
  private armTimer(delayMs: number, callback: () => void): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    const schedule: AbadgeScheduler =
      "agentId" in this.config && this.config.schedulerFn ? this.config.schedulerFn : setTimeout;
    this.refreshTimer = schedule(callback, delayMs);
    this.refreshTimer?.unref?.();
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

  /**
   * Agent-scoped wrapper around the shared `call` helper that fast-rejects
   * when background session refresh has been exhausted. Keeps the sessionExpired
   * check in one place rather than leaking into every access method body.
   */
  private authedCall<T>(operation: () => Promise<T>, fallback: string): Promise<T> {
    if (this.sessionExpired) {
      return Promise.reject(
        new AbadgeApiError(
          401,
          "SESSION_REFRESH_FAILED",
          "Agent session refresh exhausted; reconnect required",
          "Call disconnect() + connect() again, or instantiate a fresh AbadgeAgentClient.",
        ),
      );
    }
    return call(operation, fallback);
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
    return this.authedCall(
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
    return this.authedCall(() => this.client.agents.self.query(), "Failed to fetch agent");
  }

  // -- Items (read-only) ----------------------------------------------------

  /**
   * List all items visible to this agent (metadata only, no encrypted data).
   *
   * @returns Array of item summaries
   */
  async listItems(): Promise<ItemListResult> {
    return this.authedCall(() => this.client.items.listForAgent.query(), "Failed to list items");
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
    return this.authedCall(
      () => this.client.items.get.query({ itemId: id }),
      "Failed to fetch item",
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
    return this.authedCall(
      () => this.client.audit.listForAgent.query(filters),
      "Failed to fetch audit log",
    );
  }

  // -- Access (unified) -----------------------------------------------------

  /**
   * §RM-PR2 canonical access surface. Both `read` and `use` are evaluated by
   * the unified pipeline server-side; ZK vs server_managed dispatch is implicit
   * in the response shape.
   *
   * @example
   * ```typescript
   * const result = await agent.access.read("item_id");
   * if (result.storageMode === "server_managed") {
   *   // payload contains decrypted plaintext fields
   * } else {
   *   // ZK envelope: decrypt client-side via daemon
   * }
   *
   * const mount = await agent.access.use({ itemId: "item_id" }, { delivery: "env" });
   * // mount.mountId is an opaque handle; redeem via daemon.
   * ```
   */
  readonly access = {
    /**
     * Read an item: ZK items return an encrypted envelope for local decrypt,
     * server-managed items return the decrypted payload. Local-only for ZK
     * items (constraint enforced server-side).
     *
     * @param itemId - The item to read
     * @param opts - Optional field selector + purpose audit string
     * @throws {AbadgeApiError} PERMISSION_DENIED, PERMISSION_EXPIRED, ITEM_NOT_FOUND, INVALID_CAPABILITY
     */
    read: (
      itemId: string,
      opts?: { field?: string; purpose?: string },
    ): Promise<ReadAccessResponse> =>
      this.authedCall(
        () =>
          this.client.access.read.mutate({
            itemId,
            ...(opts?.field ? { field: opts.field } : {}),
            ...(opts?.purpose ? { purpose: opts.purpose } : {}),
          }),
        "Failed to read item",
      ),
    /**
     * Mint a short-lived mount handle for one item (or every item in a
     * profile). The local daemon redeems the handle for the actual material;
     * the SDK never sees plaintext on this path. Local-only (constraint
     * enforced server-side).
     *
     * @param target - Either `{ itemId }` for a single item or `{ profileId }`
     *   for every item in a profile the agent has `use` grants on.
     * @param opts - `delivery` (env or file), optional field, env var name, and purpose.
     * @returns A {@link UseAccessResponse} for item targets, or
     *   {@link ProfileUseAccessResponse} for profile targets.
     * @throws {AbadgeApiError} PERMISSION_DENIED, PROFILE_NOT_FOUND, INVALID_CAPABILITY
     */
    use: (
      target: { itemId: string } | { profileId: string },
      opts: {
        delivery: "env" | "file";
        field?: string;
        envVarName?: string;
        purpose?: string;
      },
    ): Promise<UseAccessResponse | ProfileUseAccessResponse> => {
      if ("itemId" in target) {
        return this.authedCall(
          () =>
            this.client.access.use.mutate({
              itemId: target.itemId,
              delivery: opts.delivery,
              ...(opts.field ? { field: opts.field } : {}),
              ...(opts.envVarName ? { envVarName: opts.envVarName } : {}),
              ...(opts.purpose ? { purpose: opts.purpose } : {}),
            }),
          "Failed to mint mount handle",
        );
      }
      return this.authedCall(
        () =>
          this.client.access.useProfile.mutate({
            profileId: target.profileId,
            delivery: opts.delivery,
            ...(opts.purpose ? { purpose: opts.purpose } : {}),
          }),
        "Failed to mint profile mount handles",
      );
    },
    /**
     * Atomically consume a previously-minted mount handle. Returns the
     * underlying ZK envelope or the server-decrypted payload depending on
     * the item's storage mode. Stolen / expired / double-redeemed handles
     * fail with `MOUNT_NOT_FOUND`.
     */
    redeemMount: (mountId: string): Promise<RedeemMountResponse> =>
      this.authedCall(
        () => this.client.access.redeemMount.mutate({ mountId }),
        "Failed to redeem mount handle",
      ),
  } as const;

  // -- Access (legacy) ------------------------------------------------------

  /**
   * Read the encrypted blob of a zero-knowledge item for local decryption.
   * Requires `read_ciphertext` permission. Local agents only. ZK items only.
   *
   * Every access attempt (allowed or denied) is recorded in the audit log.
   *
   * @param itemId - Item ID
   * @returns Encrypted item key, ciphertext, and crypto version
   * @throws {AbadgeApiError} FORBIDDEN, PERMISSION_DENIED, PERMISSION_EXPIRED, ITEM_NOT_FOUND
   * @deprecated Use {@link access.read} instead. Removal target: v0.6.
   */
  async accessCiphertext(itemId: string): Promise<CiphertextAccessResponse> {
    return this.authedCall(
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
   * @deprecated Use {@link access.read} instead. Removal target: v0.6.
   */
  async accessReveal(itemId: string, field?: string): Promise<RevealAccessResponse> {
    return this.authedCall(
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
   * @deprecated Use {@link access.use} instead. Removal target: v0.6.
   */
  async accessMount(
    itemId: string,
    mountType: "env" | "file",
    field?: string,
  ): Promise<MountAccessResponse> {
    return this.authedCall(
      () => this.client.access.mount.mutate({ itemId, mountType, ...(field ? { field } : {}) }),
      "Failed to access mount payload",
    );
  }

  /**
   * Bulk-fetch every item in the given profile that the agent has `mount_env`
   * on, in one round trip. Each item access produces its own audit row
   * (`access.mount_env`, `meta.viaBulk = true`).
   *
   * Profile-scoped by hard server invariant: items in other profiles are NOT
   * returned even if the agent has grants on them. Cross-org probing yields
   * `PROFILE_NOT_FOUND` (existence is not leaked).
   *
   * Used by `abadge run --all`. Local agents only.
   *
   * @param profileId - The profile to scope the bulk mount to
   * @returns Array of per-item mount responses (ZK envelope or server-managed payload)
   * @throws {AbadgeApiError} PERMISSION_DENIED (remote agent), PROFILE_NOT_FOUND, BAD_REQUEST (>256 items)
   * @deprecated Use `access.use({ profileId }, { delivery })` instead. Removal target: v0.6.
   */
  async bulkAccessMountEnv(profileId: string): Promise<BulkMountEnvResponse> {
    return this.authedCall(
      () => this.client.access.bulkMountEnv.mutate({ profileId }),
      "Failed to bulk-fetch mount payloads",
    );
  }
}

// Re-export ErrorCode for SDK consumers
export type { ErrorCode } from "@abadge/core";

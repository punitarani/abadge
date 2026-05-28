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

interface TrpcMutationWithoutInput<TOutput> {
  mutate(): Promise<TOutput>;
}

/** Optional keyset-pagination input shared by the cursor-paginated lists (§AB-0050). */
type ListPageInput = { cursor?: string; limit?: number };

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
    list: TrpcQuery<ListPageInput, ItemListResult>;
    listForAgent: TrpcQuery<ListPageInput, ItemListResult>;
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
    list: TrpcQuery<ListPageInput, AgentListResult>;
    self: TrpcQueryWithoutInput<AgentResult>;
    rotate: TrpcMutation<{ agentId: string }, AgentRotateResult>;
    revoke: TrpcMutation<{ agentId: string }, SuccessResult>;
  };
  permissions: {
    create: TrpcMutation<CreatePermissionInput, PermissionListResult>;
    list: TrpcQuery<PermissionFilters & ListPageInput, PermissionListResult>;
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
          isPersonal: boolean;
        };
      }
    >;
    createPersonal: TrpcMutationWithoutInput<{
      organization: {
        id: string;
        name: string;
        slug: string;
        logo: string | null;
        createdAt: string;
        isPersonal: boolean;
      };
    }>;
    list: TrpcQueryWithoutInput<{
      organizations: Array<{
        id: string;
        name: string;
        slug: string;
        logo: string | null;
        createdAt: string;
        role: string;
        hasBootstrappedProfile: boolean;
        isPersonal: boolean;
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

/**
 * The per-request page size the drainer asks for. Equal to the server's
 * `MAX_PAGE_LIMIT` (§AB-0050); requesting the ceiling minimises round-trips.
 * Asking for more would be rejected by input validation, not clamped.
 */
const DRAIN_PAGE_SIZE = 100;

/**
 * Pure runaway-loop guard. A `nextCursor` that never resolves to `null` means a
 * server-side cursor bug; an unbounded client loop is worse than a loud failure.
 * 1000 pages × the 100-row ceiling is far above any realistic org size.
 */
const MAX_DRAIN_PAGES = 1000;

/**
 * Follow `nextCursor` across every page of a cursor-paginated list and return
 * the concatenation. The server caps each request (§AB-0050); this restores the
 * "return everything" contract that the SDK list helpers had before pagination,
 * so callers that need the full set (CLI export/import, list-then-find) keep
 * working. Throws if pagination fails to terminate (see {@link MAX_DRAIN_PAGES}).
 */
async function drainPages<T>(
  fetchPage: (
    cursor: string | undefined,
    limit: number,
  ) => Promise<{ rows: readonly T[]; nextCursor: string | null }>,
  fallback: string,
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_DRAIN_PAGES; page++) {
    const { rows, nextCursor } = await call(() => fetchPage(cursor, DRAIN_PAGE_SIZE), fallback);
    all.push(...rows);
    if (!nextCursor) return all;
    cursor = nextCursor;
  }
  throw new AbadgeApiError(
    500,
    "PAGINATION_RUNAWAY",
    `Pagination did not terminate after ${MAX_DRAIN_PAGES} pages`,
    "This indicates a server-side cursor bug; report it with your X-Request-Id.",
  );
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
   * §RM-PR4 — Namespaced API surface.
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
      isPersonal: boolean;
    }>;
    createPersonal: () => Promise<{ id: string; name: string; slug: string; isPersonal: boolean }>;
    list: () => Promise<{
      organizations: Array<{
        id: string;
        name: string;
        slug: string;
        logo: string | null;
        createdAt: string;
        role: string;
        hasBootstrappedProfile: boolean;
        isPersonal: boolean;
      }>;
    }>;
    get: (orgId: string) => Promise<unknown>;
    update: (orgId: string, data: { name?: string }) => Promise<SuccessResult>;
    delete: (orgId: string) => Promise<SuccessResult>;
  };

  readonly profiles: {
    create: (data: {
      orgId: string;
      name: string;
      description?: string;
      storageMode?: string;
    }) => Promise<{ id: string; name: string; storageMode: string }>;
    list: (orgId: string) => Promise<{
      profiles: Array<{
        id: string;
        name: string;
        storageMode: string;
        organizationId: string;
        keyVersion: number;
        createdAt: string;
        updatedAt: string;
      }>;
    }>;
    get: (profileId: string) => Promise<unknown>;
    update: (profileId: string, data: ChangePasswordInput) => Promise<SuccessResult>;
    delete: (profileId: string) => Promise<SuccessResult>;
  };

  readonly items: {
    create: (data: CreateItemInput) => Promise<{ id: string }>;
    list: () => Promise<ItemListResult>;
    get: (id: string) => Promise<ItemResult>;
    update: (id: string, data: UpdateItemInput) => Promise<{ ok: boolean; contentVersion: number }>;
    delete: (id: string) => Promise<SuccessResult>;
  };

  readonly agents: {
    create: (data: CreateAgentInput) => Promise<AgentWithKey>;
    list: () => Promise<AgentListResult>;
    get: (agentId: string) => Promise<AgentResult>;
    update: (agentId: string) => Promise<AgentRotateResult>;
    delete: (agentId: string) => Promise<SuccessResult>;
  };

  readonly permissions: {
    create: (data: CreatePermissionInput) => Promise<PermissionListResult>;
    list: (filters?: PermissionFilters) => Promise<PermissionListResult>;
    get: (permissionId: string) => Promise<unknown>;
    update: (permissionId: string) => Promise<SuccessResult>;
    delete: (permissionId: string) => Promise<SuccessResult>;
  };

  readonly audit: {
    list: (filters?: AuditFilters) => Promise<AuditListResult>;
  };

  constructor(config: AbadgeUserClientConfig) {
    this.client = buildTrpcClient(config.apiUrl, config.sessionToken, config.orgId);

    this.orgs = {
      create: async (data) => {
        const result = await call(
          () => this.client.organizations.create.mutate(data),
          "Failed to create organization",
        );
        return result.organization;
      },
      createPersonal: async () => {
        const result = await call(
          () => this.client.organizations.createPersonal.mutate(),
          "Failed to create personal account",
        );
        return result.organization;
      },
      list: () =>
        call(() => this.client.organizations.list.query(), "Failed to list organizations"),
      get: (orgId) =>
        call(() => this.client.organizations.get.query({ orgId }), "Failed to fetch organization"),
      update: (orgId, data) =>
        call(
          () => this.client.organizations.update.mutate({ orgId, ...data }),
          "Failed to update organization",
        ),
      delete: (orgId) =>
        call(
          () => this.client.organizations.delete.mutate({ orgId }),
          "Failed to delete organization",
        ),
    };

    this.profiles = {
      create: async (data) => {
        const result = await call(
          () => this.client.profiles.create.mutate(data),
          "Failed to create profile",
        );
        return result.profile;
      },
      list: (orgId) =>
        call(() => this.client.profiles.list.query({ orgId }), "Failed to list profiles"),
      get: (profileId) =>
        call(() => this.client.profiles.get.query({ profileId }), "Failed to fetch profile"),
      update: (profileId, data) =>
        call(
          () => this.client.profiles.changePassword.mutate({ profileId, ...data }),
          "Failed to change profile password",
        ),
      delete: (profileId) =>
        call(() => this.client.profiles.delete.mutate({ profileId }), "Failed to delete profile"),
    };

    this.items = {
      create: (data) => call(() => this.client.items.create.mutate(data), "Failed to create item"),
      list: async () => {
        const items = await drainPages(async (cursor, limit) => {
          const page = await this.client.items.list.query({ cursor, limit });
          return { rows: page.items, nextCursor: page.nextCursor };
        }, "Failed to list items");
        return { items, nextCursor: null };
      },
      get: (id) => call(() => this.client.items.get.query({ itemId: id }), "Failed to fetch item"),
      update: (id, data) =>
        call(() => this.client.items.update.mutate({ itemId: id, data }), "Failed to update item"),
      delete: (id) =>
        call(() => this.client.items.delete.mutate({ itemId: id }), "Failed to delete item"),
    };

    this.agents = {
      create: (data) =>
        call(() => this.client.agents.create.mutate(data), "Failed to create agent"),
      list: async () => {
        const agents = await drainPages(async (cursor, limit) => {
          const page = await this.client.agents.list.query({ cursor, limit });
          return { rows: page.agents, nextCursor: page.nextCursor };
        }, "Failed to list agents");
        return { agents, nextCursor: null };
      },
      get: async (agentId: string) => {
        const { agents } = await this.agents.list();
        const found = agents.find((a: { id: string }) => a.id === agentId);
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
      update: (agentId) =>
        call(() => this.client.agents.rotate.mutate({ agentId }), "Failed to rotate agent"),
      delete: (agentId) =>
        call(() => this.client.agents.revoke.mutate({ agentId }), "Failed to revoke agent"),
    };

    this.permissions = {
      create: (data) =>
        call(() => this.client.permissions.create.mutate(data), "Failed to create permission"),
      list: async (filters = {}) => {
        const permissions = await drainPages(async (cursor, limit) => {
          const page = await this.client.permissions.list.query({ ...filters, cursor, limit });
          return { rows: page.permissions, nextCursor: page.nextCursor };
        }, "Failed to list permissions");
        return { permissions, nextCursor: null };
      },
      get: async (permissionId: string) => {
        const { permissions } = await this.permissions.list();
        const found = permissions.find((p: { id: string }) => p.id === permissionId);
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
      update: (permissionId) =>
        call(
          () => this.client.permissions.revoke.mutate({ permissionId }),
          "Failed to revoke permission",
        ),
      delete: (permissionId) =>
        call(
          () => this.client.permissions.revoke.mutate({ permissionId }),
          "Failed to revoke permission",
        ),
    };

    this.audit = {
      list: (filters = {}) =>
        call(() => this.client.audit.list.query(filters), "Failed to fetch audit log"),
    };
  }

  /**
   * Reveal an item's plaintext as the owning user (bypasses agent permission check).
   * Only available to org members with the owner/admin role.
   *
   * @param itemId - Item ID
   */
  async ownerReveal(itemId: string): Promise<RevealAccessResponse> {
    return call(() => this.client.items.ownerReveal.mutate({ itemId }), "Failed to reveal item");
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
    // The session guard is inlined rather than wrapping drainPages in
    // authedCall: drainPages already routes each page through call(), and a
    // second call() around it would re-normalize an AbadgeApiError into a
    // generic 500/UNKNOWN, dropping the real statusCode/code/hint/meta.
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
    const items = await drainPages(async (cursor, limit) => {
      const page = await this.client.items.listForAgent.query({ cursor, limit });
      return { rows: page.items, nextCursor: page.nextCursor };
    }, "Failed to list items");
    return { items, nextCursor: null };
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
}

// Re-export ErrorCode for SDK consumers
export type { ErrorCode } from "@abadge/core";

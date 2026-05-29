import type { AgentKind, Capability } from "@abadge/core";
import { AGENT_SESSION_PREFIX } from "@abadge/core";
import { serverEncrypt } from "@abadge/crypto/server";
import {
  generateEd25519KeyPair,
  generateOpaqueToken,
  hashApiKey,
  randomBytes,
  toBase64,
} from "@abadge/crypto/shared";
import type { Database } from "@abadge/db";
import { agentSessions, agents, items, permissions, profiles } from "@abadge/db/schema";
import { getTestHelpers, type TestAuth } from "./test-auth";
import { getTestDb } from "./test-db";
import { TEST_ENV } from "./test-env";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uuid(): string {
  return crypto.randomUUID();
}

function localityFromKind(kind: AgentKind): "local" | "remote" {
  return kind === "remote" ? "remote" : "local";
}

/** Fake base64 blob of `n` random bytes — used for ZK item fields the server never decrypts. */
function fakeBlob(n = 48): string {
  return toBase64(randomBytes(n));
}

// ---------------------------------------------------------------------------
// seedUser
// ---------------------------------------------------------------------------

export interface SeedUserResult {
  userId: string;
  email: string;
  name: string;
  headers: Headers;
  /** Raw session token — use for explicit Bearer-path testing */
  token: string;
}

export async function seedUser(
  auth: TestAuth,
  overrides?: { email?: string; name?: string },
): Promise<SeedUserResult> {
  const helpers = await getTestHelpers(auth);

  const email = overrides?.email ?? `user-${uuid()}@test.local`;
  const name = overrides?.name ?? "Test User";

  // Create user object via factory, then persist to DB
  const userData = helpers.createUser({ email, name, emailVerified: true });
  const savedUser = await helpers.saveUser(userData);
  const userId = savedUser.id as string;

  // Login creates a session and returns cookie-based headers + raw token
  const loginResult = await helpers.login({ userId });

  return {
    userId,
    email,
    name,
    headers: loginResult.headers,
    token: loginResult.token,
  };
}

// ---------------------------------------------------------------------------
// seedOrg
// ---------------------------------------------------------------------------

export interface SeedOrgResult {
  orgId: string;
  slug: string;
}

export async function seedOrg(
  auth: TestAuth,
  userId: string,
  overrides?: {
    name?: string;
    slug?: string;
    /**
     * When `false`, skips the default `server_managed` profile seed so the
     * org is left in the "no profile" state. Used by the few tests that
     * exercise the rare "all profiles deleted" code paths. Defaults to
     * `true` so seeded orgs are immediately usable.
     *
     * Note: the onboarding-completeness gate was removed in §REVAMP-PR3
     * Task 5.2; production `organizations.create` auto-seeds a default
     * profile (Task 5.1). This helper mirrors that behaviour for tests
     * that bypass the tRPC layer.
     */
    withDefaultProfile?: boolean;
  },
): Promise<SeedOrgResult> {
  const helpers = await getTestHelpers(auth);

  const orgId = uuid();
  const slug = overrides?.slug ?? `org-${uuid()}`;
  const name = overrides?.name ?? "Test Org";

  // Use testUtils org helpers (available because organization plugin is loaded)
  await helpers.saveOrganization({ id: orgId, name, slug, createdAt: new Date() });
  await helpers.addMember({ userId, organizationId: orgId, role: "owner" });

  if (overrides?.withDefaultProfile !== false) {
    await seedProfile(getTestDb(), orgId, { storageMode: "server_managed" });
  }

  return { orgId, slug };
}

// ---------------------------------------------------------------------------
// seedMember
// ---------------------------------------------------------------------------

/**
 * Adds an already-seeded user to an organization with the given role.
 * Defaults to "member" (non-owner). Use `seedOrg` instead when you want to
 * create the org + attach the owner in one step.
 */
export async function seedMember(
  auth: TestAuth,
  orgId: string,
  userId: string,
  role: "owner" | "admin" | "member" = "member",
): Promise<void> {
  const helpers = await getTestHelpers(auth);
  await helpers.addMember({ userId, organizationId: orgId, role });
}

// ---------------------------------------------------------------------------
// seedProfile
// ---------------------------------------------------------------------------

export interface SeedProfileResult {
  profileId: string;
}

export async function seedProfile(
  db: Database,
  orgId: string,
  overrides?: {
    name?: string;
    storageMode?: "zero_knowledge" | "server_managed";
    /**
     * When true, populates `wrappedRootKey`/`kdfSalt`/`kdfParams` so the
     * profile passes the "is bootstrapped" precondition guarded by the ZK
     * mutation procedures (`changePassword`, `setupRecovery`, `rotateKey`).
     * Defaults to false; pass true for tests that exercise those paths
     * without driving the client-side KDF.
     */
    bootstrapped?: boolean;
  },
): Promise<SeedProfileResult> {
  const profileId = uuid();
  const bootstrapped = overrides?.bootstrapped === true;

  await db.insert(profiles).values({
    id: profileId,
    organizationId: orgId,
    name: overrides?.name ?? `profile-${uuid()}`,
    storageMode: overrides?.storageMode ?? "server_managed",
    ...(bootstrapped
      ? {
          wrappedRootKey: "seed-wrapped-root-key",
          kdfSalt: "seed-salt",
          kdfParams: {
            algorithm: "argon2id" as const,
            memory: 65536,
            iterations: 3,
            parallelism: 1,
            hashLength: 32,
          },
        }
      : {}),
  });

  return { profileId };
}

// ---------------------------------------------------------------------------
// seedServerItem
// ---------------------------------------------------------------------------

export interface SeedServerItemResult {
  itemId: string;
  label: string;
}

export async function seedServerItem(
  db: Database,
  opts: {
    userId: string;
    orgId: string;
    profileId?: string;
    label?: string;
    fields?: Record<string, string>;
  },
): Promise<SeedServerItemResult> {
  const itemId = uuid();
  const label = opts.label ?? `item-${uuid()}`;
  const fields = opts.fields ?? { username: "admin", password: "s3cret" };

  // Must match the ItemPayload structure that decodeServerManagedPayload expects:
  // { v: 1, label, kind: "opaque", tags: [...], fields: {...} }
  const payload = { v: 1, label, kind: "opaque" as const, tags: [] as string[], fields };
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = await serverEncrypt(plaintext, TEST_ENV.ENCRYPTION_KEY, 1);

  await db.insert(items).values({
    id: itemId,
    organizationId: opts.orgId,
    profileId: opts.profileId ?? null,
    createdBy: opts.userId,
    label,
    storageMode: "server_managed",
    serverCiphertext: encrypted.ciphertext,
    serverIv: encrypted.iv,
    serverKeyVersion: encrypted.keyVersion,
  });

  return { itemId, label };
}

// ---------------------------------------------------------------------------
// seedZkItem
// ---------------------------------------------------------------------------

export interface SeedZkItemResult {
  itemId: string;
  label: string;
}

export async function seedZkItem(
  db: Database,
  opts: {
    userId: string;
    orgId: string;
    profileId: string;
    label?: string;
  },
): Promise<SeedZkItemResult> {
  const itemId = uuid();
  const label = opts.label ?? `zk-item-${uuid()}`;

  await db.insert(items).values({
    id: itemId,
    organizationId: opts.orgId,
    profileId: opts.profileId,
    createdBy: opts.userId,
    label,
    storageMode: "zero_knowledge",
    encryptedItemKey: fakeBlob(56),
    ciphertext: fakeBlob(128),
  });

  return { itemId, label };
}

// ---------------------------------------------------------------------------
// seedAgent
// ---------------------------------------------------------------------------

export interface SeedAgentResult {
  agentId: string;
  name: string;
  keyPair: { publicKey: string; privateKey: string };
}

// All agents use public_key_session (Ed25519 keypair → `abs_` session tokens).
// To authenticate a seeded agent in a test, mint a session with
// `seedAgentSession` and pass its `rawToken` to `createAgentCaller`.
export async function seedAgent(
  db: Database,
  opts: {
    userId: string;
    orgId: string;
    name?: string;
    kind?: AgentKind;
  },
): Promise<SeedAgentResult> {
  const agentId = uuid();
  const name = opts.name ?? `agent-${uuid()}`;
  const kind: AgentKind = opts.kind ?? "local_cli";
  const locality = localityFromKind(kind);
  const keyPair = await generateEd25519KeyPair();

  // agents: FK target for agentSessions/agentEnrollmentTokens/agentSessionChallenges and queried by tRPC routers
  await db.insert(agents).values({
    id: agentId,
    organizationId: opts.orgId,
    createdBy: opts.userId,
    name,
    kind,
    locality,
    authMethod: "public_key_session",
    publicKey: keyPair.publicKey,
  });

  return { agentId, name, keyPair };
}

// ---------------------------------------------------------------------------
// seedAgentSession
// ---------------------------------------------------------------------------

export interface SeedAgentSessionResult {
  sessionId: string;
  rawToken: string;
}

export async function seedAgentSession(
  db: Database,
  opts: {
    agentId: string;
    userId: string;
    expiresInMs?: number;
    revokedAt?: Date;
  },
): Promise<SeedAgentSessionResult> {
  const sessionId = uuid();
  const rawToken = generateOpaqueToken(AGENT_SESSION_PREFIX);
  const tokenHash = await hashApiKey(rawToken);

  const defaultTtl = 15 * 60 * 1000; // 15 minutes
  const expiresAt = new Date(Date.now() + (opts.expiresInMs ?? defaultTtl));

  await db.insert(agentSessions).values({
    id: sessionId,
    agentId: opts.agentId,
    userId: opts.userId,
    tokenHash,
    expiresAt,
    revokedAt: opts.revokedAt ?? null,
  });

  return { sessionId, rawToken };
}

export interface SeedAuthenticatedAgentResult extends SeedAgentResult {
  /** An `abs_` session token ready to pass to `createAgentCaller`. */
  rawToken: string;
}

/**
 * Seed a keypair agent AND a live `abs_` session for it in one step — the
 * standard way to get an authenticated agent caller in integration tests.
 */
export async function seedAuthenticatedAgent(
  db: Database,
  opts: {
    userId: string;
    orgId: string;
    name?: string;
    kind?: AgentKind;
    expiresInMs?: number;
  },
): Promise<SeedAuthenticatedAgentResult> {
  const agent = await seedAgent(db, opts);
  const { rawToken } = await seedAgentSession(db, {
    agentId: agent.agentId,
    userId: opts.userId,
    expiresInMs: opts.expiresInMs,
  });
  return { ...agent, rawToken };
}

// ---------------------------------------------------------------------------
// seedPermission
// ---------------------------------------------------------------------------

export interface SeedPermissionResult {
  permissionId: string;
}

export async function seedPermission(
  db: Database,
  opts: {
    orgId: string;
    agentId: string;
    itemId: string;
    capability: Capability;
    grantedBy: string;
    expiresAt?: Date;
  },
): Promise<SeedPermissionResult> {
  const permissionId = uuid();

  await db.insert(permissions).values({
    id: permissionId,
    organizationId: opts.orgId,
    agentId: opts.agentId,
    itemId: opts.itemId,
    capability: opts.capability,
    grantedBy: opts.grantedBy,
    expiresAt: opts.expiresAt ?? null,
  });

  return { permissionId };
}

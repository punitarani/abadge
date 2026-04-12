import type { Database } from "@abadge/db";
import {
  agents,
  agentSessions,
  items,
  member,
  organization,
  permissions,
  principals,
  profiles,
} from "@abadge/db/schema";
import { AGENT_SESSION_PREFIX, API_KEY_PREFIX } from "@abadge/core";
import type { AgentKind, Capability, PrincipalAuthMethod } from "@abadge/core";
import {
  generateApiKey,
  generateEd25519KeyPair,
  generateOpaqueToken,
  hashApiKey,
  toBase64,
  randomBytes,
} from "@abadge/crypto/shared";
import { serverEncrypt } from "@abadge/crypto/server";
import type { TestAuth } from "./test-auth";
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

function apiKeyPrefixFromKind(kind: AgentKind): string {
  return kind === "remote" ? API_KEY_PREFIX.remote : API_KEY_PREFIX.local;
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
}

export async function seedUser(
  auth: TestAuth,
  overrides?: { email?: string; password?: string; name?: string },
): Promise<SeedUserResult> {
  const email = overrides?.email ?? `user-${uuid()}@test.local`;
  const password = overrides?.password ?? "test-password-123!";
  const name = overrides?.name ?? "Test User";

  const result = await auth.api.signUpEmail({
    body: { email, password, name },
  });

  const headers = new Headers();
  headers.set("authorization", `Bearer ${result.token}`);

  return { userId: result.user.id as string, email, name, headers };
}

// ---------------------------------------------------------------------------
// seedOrg
// ---------------------------------------------------------------------------

export interface SeedOrgResult {
  orgId: string;
  slug: string;
}

export async function seedOrg(
  db: Database,
  _auth: TestAuth,
  userId: string,
  overrides?: { name?: string; slug?: string },
): Promise<SeedOrgResult> {
  const orgId = uuid();
  const slug = overrides?.slug ?? `org-${uuid()}`;
  const name = overrides?.name ?? "Test Org";

  await db.insert(organization).values({
    id: orgId,
    name,
    slug,
  });

  await db.insert(member).values({
    id: uuid(),
    organizationId: orgId,
    userId,
    role: "owner",
  });

  return { orgId, slug };
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
  overrides?: { name?: string; storageMode?: "zero_knowledge" | "server_managed" },
): Promise<SeedProfileResult> {
  const profileId = uuid();

  await db.insert(profiles).values({
    id: profileId,
    organizationId: orgId,
    name: overrides?.name ?? `profile-${uuid()}`,
    storageMode: overrides?.storageMode ?? "server_managed",
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
  const payload = opts.fields ?? { username: "admin", password: "s3cret" };

  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = await serverEncrypt(plaintext, TEST_ENV.ENCRYPTION_KEY, 1);

  await db.insert(items).values({
    id: itemId,
    organizationId: opts.orgId,
    profileId: opts.profileId ?? null,
    userId: opts.userId,
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
    userId: opts.userId,
    label,
    storageMode: "zero_knowledge",
    encryptedItemKey: fakeBlob(56),
    keyNonce: fakeBlob(24),
    ciphertext: fakeBlob(128),
    contentNonce: fakeBlob(24),
  });

  return { itemId, label };
}

// ---------------------------------------------------------------------------
// seedAgent
// ---------------------------------------------------------------------------

export interface SeedAgentResult {
  agentId: string;
  name: string;
  apiKey?: string;
  keyPair?: { publicKey: string; privateKey: string };
}

export async function seedAgent(
  db: Database,
  opts: {
    userId: string;
    orgId: string;
    name?: string;
    kind?: AgentKind;
    authMethod?: PrincipalAuthMethod;
  },
): Promise<SeedAgentResult> {
  const agentId = uuid();
  const name = opts.name ?? `agent-${uuid()}`;
  const kind: AgentKind = opts.kind ?? "local_cli";
  const locality = localityFromKind(kind);
  const authMethod: PrincipalAuthMethod = opts.authMethod ?? "legacy_api_key";

  let secretHash: string | null = null;
  let secretPrefix: string | null = null;
  let publicKey: string | null = null;
  let apiKey: string | undefined;
  let keyPair: { publicKey: string; privateKey: string } | undefined;

  if (authMethod === "legacy_api_key") {
    const prefix = apiKeyPrefixFromKind(kind);
    const generated = await generateApiKey(prefix);
    secretHash = generated.hash;
    secretPrefix = generated.prefix;
    apiKey = generated.key;
  } else {
    const kp = await generateEd25519KeyPair();
    publicKey = kp.publicKey;
    keyPair = kp;
  }

  // Insert into BOTH tables with the SAME id.
  // principals: FK target for agentSessions, agentEnrollmentTokens, agentSessionChallenges
  // agents: queried by tRPC routers for business logic
  await db.insert(principals).values({
    id: agentId,
    userId: opts.userId,
    kind,
    locality,
    authMethod,
    name,
    secretHash,
    secretPrefix,
    publicKey,
  });

  await db.insert(agents).values({
    id: agentId,
    organizationId: opts.orgId,
    createdBy: opts.userId,
    name,
    kind,
    locality,
    authMethod,
    secretHash,
    secretPrefix,
    publicKey,
  });

  return { agentId, name, apiKey, keyPair };
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
  });

  return { sessionId, rawToken };
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

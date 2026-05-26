import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { serverEncrypt } from "@abadge/crypto/server";
import { profileIdForServerAad, SERVER_AAD_MIN_VERSION } from "@abadge/crypto/shared";
import { and, eq } from "@abadge/db";
import { items, permissions, profiles } from "@abadge/db/schema";
import { seedAgent, seedAgentSession, seedOrg, seedProfile, seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createAgentCaller, createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";
import { TEST_ENV } from "../helpers/test-env";

/**
 * §AB-0001 (P0) + §AB-0002 — server-managed items must be bound to a real
 * profile at create time so profile-level grants cover them and the AAD is
 * profile-scoped, while pre-fix NULL-profile rows keep decrypting.
 */
describe("server-managed item profile binding (AB-0001 / AB-0002)", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  async function serverProfileId(orgId: string): Promise<string> {
    const [p] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(and(eq(profiles.organizationId, orgId), eq(profiles.storageMode, "server_managed")))
      .limit(1);
    if (!p) throw new Error("expected a seeded server_managed profile");
    return p.id;
  }

  // AB-0001 #1 + #4 — create binds the org's default server_managed profile and round-trips.
  test("server_managed create binds the default profile (non-null) and round-trips", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const defaultProfileId = await serverProfileId(org.orgId);

    const created = await caller.items.create({
      storageMode: "server_managed",
      payload: { v: 1, label: "bound", kind: "opaque", tags: [], fields: { token: "abc123" } },
    });

    const [row] = await db
      .select({ profileId: items.profileId })
      .from(items)
      .where(eq(items.id, created.id));
    expect(row?.profileId).toBe(defaultProfileId);

    const revealed = await caller.items.ownerReveal({ itemId: created.id });
    expect((revealed.payload.fields as Record<string, string>).token).toBe("abc123");
  });

  // AB-0001 #2 — the core P0 proof: a PROFILE-level grant now covers a freshly
  // created server_managed item end-to-end (owner creates -> profile grant ->
  // agent reveals). Before the fix the item had profileId=NULL and the profile
  // grant was silently skipped in lookupPermission.
  test("a profile-level grant covers a new server_managed item (agent reveal succeeds)", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const created = await caller.items.create({
      storageMode: "server_managed",
      payload: {
        v: 1,
        label: "grant-target",
        kind: "opaque",
        tags: [],
        fields: { value: "grant-covers-me" },
      },
    });

    const [row] = await db
      .select({ profileId: items.profileId })
      .from(items)
      .where(eq(items.id, created.id));
    const profileId = row?.profileId;
    expect(profileId).toBeTruthy();
    if (!profileId) throw new Error("created item has no profileId");

    const agent = await seedAgent(db, { userId: owner.userId, orgId: org.orgId, kind: "remote" });

    // Profile-target grant (itemId NULL, profileId set) — the exactly-one-target
    // CHECK requires this shape; seedPermission only does item-target grants.
    await db.insert(permissions).values({
      id: crypto.randomUUID(),
      organizationId: org.orgId,
      agentId: agent.agentId,
      itemId: null,
      profileId,
      capability: "reveal_plaintext",
      grantedBy: owner.userId,
    });

    const session = await seedAgentSession(db, { agentId: agent.agentId, userId: owner.userId });
    const agentCaller = createAgentCaller(db, auth, session.rawToken);

    // access.read is the canonical (non-deprecated) reveal path; it resolves
    // through resolveAccess -> lookupPermission, which honors profile grants.
    // reveal_plaintext maps to the canonical "read" action (LEGACY_TO_CANONICAL),
    // so the profile-level reveal_plaintext grant authorizes it.
    const result = await agentCaller.access.read({ itemId: created.id });
    const fields = (result as { payload?: { fields?: Record<string, string> } }).payload?.fields;
    expect(fields?.value).toBe("grant-covers-me");
  });

  // AB-0001 #3 — regression: a row written BEFORE the fix (server_managed,
  // profileId NULL, AAD-bound v2 under the no-profile sentinel) must still
  // decrypt, because decrypt reproduces the sentinel from the stored NULL.
  test("a pre-fix NULL-profile sentinel-AAD row still decrypts", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const itemId = crypto.randomUUID();
    const payload = {
      v: 1,
      label: "legacy-sentinel",
      kind: "opaque" as const,
      tags: [] as string[],
      fields: { token: "still-decryptable" },
    };
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));
    // Reproduce exactly what items.create wrote before AB-0001: v2 AAD whose
    // profileId component is the no-profile sentinel, row stored with NULL profile.
    const encrypted = await serverEncrypt(
      plaintext,
      TEST_ENV.ENCRYPTION_KEY,
      SERVER_AAD_MIN_VERSION,
      {
        orgId: org.orgId,
        profileId: profileIdForServerAad(null),
        itemId,
        keyVersion: SERVER_AAD_MIN_VERSION,
      },
    );
    await db.insert(items).values({
      id: itemId,
      organizationId: org.orgId,
      profileId: null,
      createdBy: owner.userId,
      label: "legacy-sentinel",
      storageMode: "server_managed",
      serverCiphertext: encrypted.ciphertext,
      serverIv: encrypted.iv,
      serverKeyVersion: encrypted.keyVersion,
    });

    const revealed = await caller.items.ownerReveal({ itemId });
    expect((revealed.payload.fields as Record<string, string>).token).toBe("still-decryptable");
  });

  // AB-0002 #1 — explicit valid profileId places the item under that profile.
  test("explicit profileId stores the item under that profile", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const second = await seedProfile(db, org.orgId, {
      name: "second-sm",
      storageMode: "server_managed",
    });

    const created = await caller.items.create({
      storageMode: "server_managed",
      profileId: second.profileId,
      payload: { v: 1, label: "explicit", kind: "opaque", tags: [], fields: { k: "v" } },
    });

    const [row] = await db
      .select({ profileId: items.profileId })
      .from(items)
      .where(eq(items.id, created.id));
    expect(row?.profileId).toBe(second.profileId);
  });

  // AB-0002 #1 (ZK) — explicit profileId places a zero_knowledge item under
  // that specific ZK profile, not the arbitrary "first" one. Two ZK profiles
  // make the default ambiguous, so this proves the explicit id wins.
  test("explicit profileId stores a zero_knowledge item under that ZK profile", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    await seedProfile(db, org.orgId, { name: "zk-a", storageMode: "zero_knowledge" });
    const target = await seedProfile(db, org.orgId, { name: "zk-b", storageMode: "zero_knowledge" });

    const created = await caller.items.create({
      storageMode: "zero_knowledge",
      id: crypto.randomUUID(),
      profileId: target.profileId,
      label: "zk-explicit",
      encryptedItemKey: "ek-zk-explicit",
      ciphertext: "ct-zk-explicit",
    });

    const [row] = await db
      .select({ profileId: items.profileId })
      .from(items)
      .where(eq(items.id, created.id));
    expect(row?.profileId).toBe(target.profileId);
  });

  // AB-0002 #2 — a profileId from another org is rejected as PROFILE_NOT_FOUND
  // (org-scoped lookup; no cross-tenant existence leak).
  test("a profileId from another org returns PROFILE_NOT_FOUND", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const otherOrg = await seedOrg(auth, owner.userId, { slug: `other-${crypto.randomUUID()}` });
    const foreignProfileId = await serverProfileId(otherOrg.orgId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    try {
      await caller.items.create({
        storageMode: "server_managed",
        profileId: foreignProfileId,
        payload: { v: 1, label: "x", kind: "opaque", tags: [], fields: { k: "v" } },
      });
      expect.unreachable("cross-org profileId should be rejected");
    } catch (error: unknown) {
      const trpcError = error as { cause?: { code?: string } };
      expect(trpcError.cause?.code).toBe("PROFILE_NOT_FOUND");
    }
  });

  // AB-0002 #3 — a profileId whose storage mode mismatches the item mode is a
  // validation error (BAD_REQUEST with meta.reason=profile_mode_mismatch).
  test("a storage-mode-mismatched profileId is a validation error", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const zk = await seedProfile(db, org.orgId, { name: "zk", storageMode: "zero_knowledge" });
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    try {
      await caller.items.create({
        storageMode: "server_managed",
        profileId: zk.profileId,
        payload: { v: 1, label: "x", kind: "opaque", tags: [], fields: { k: "v" } },
      });
      expect.unreachable("mode-mismatched profileId should be rejected");
    } catch (error: unknown) {
      const trpcError = error as { cause?: { code?: string; meta?: { reason?: string } } };
      expect(trpcError.cause?.code).toBe("BAD_REQUEST");
      expect(trpcError.cause?.meta?.reason).toBe("profile_mode_mismatch");
    }
  });
});

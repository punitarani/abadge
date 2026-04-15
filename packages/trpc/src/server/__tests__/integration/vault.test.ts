import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes, toBase64 } from "@abadge/crypto/shared";
import { eq } from "@abadge/db";
import { items, vaults } from "@abadge/db/schema";
import { seedOrg, seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

/** Fake opaque blob -- the server never decrypts these. */
function fakeBlob(n = 48): string {
  return toBase64(randomBytes(n));
}

/**
 * Seed a legacy ZK item attached to a vault (profileId null). Mirrors the
 * user-scoped item shape that vault.rotateKey was designed to operate on.
 */
async function seedLegacyVaultItem(
  db: ReturnType<typeof getTestDb>,
  opts: { userId: string; orgId: string; vaultId: string; label: string },
): Promise<{ itemId: string; encryptedItemKey: string; keyNonce: string }> {
  const itemId = crypto.randomUUID();
  const encryptedItemKey = fakeBlob(56);
  const keyNonce = fakeBlob(24);

  await db.insert(items).values({
    id: itemId,
    organizationId: opts.orgId,
    profileId: null,
    userId: opts.userId,
    vaultId: opts.vaultId,
    label: opts.label,
    storageMode: "zero_knowledge",
    encryptedItemKey,
    keyNonce,
    ciphertext: fakeBlob(128),
    contentNonce: fakeBlob(24),
  });

  return { itemId, encryptedItemKey, keyNonce };
}

/**
 * Legacy per-user vault. Verifies the org-scoped WHERE on rotateKey's item
 * UPDATE prevents cross-tenant clobber: a user who owns two orgs must not be
 * able to rotate item-keys belonging to org A while authenticated in org B.
 */
describe("vault.rotateKey org isolation", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("does not clobber ZK items that belong to a different org", async () => {
    // Single user owning two orgs.
    const owner = await seedUser(auth);
    const orgA = await seedOrg(auth, owner.userId, { slug: `org-a-${crypto.randomUUID()}` });
    const orgB = await seedOrg(auth, owner.userId, { slug: `org-b-${crypto.randomUUID()}` });

    // Legacy user-scoped vault (one per user).
    const vaultId = crypto.randomUUID();
    await db.insert(vaults).values({
      id: vaultId,
      userId: owner.userId,
      wrappedRootKey: "initial-wrapped-root-key",
      kdfSalt: "initial-salt",
      kdfParams: {
        algorithm: "argon2id",
        memory: 65536,
        iterations: 3,
        parallelism: 1,
        hashLength: 32,
      },
    });

    // Victim item in org A.
    const itemA = await seedLegacyVaultItem(db, {
      userId: owner.userId,
      orgId: orgA.orgId,
      vaultId,
      label: "org-a-victim",
    });
    // Legitimate target item in org B.
    const itemB = await seedLegacyVaultItem(db, {
      userId: owner.userId,
      orgId: orgB.orgId,
      vaultId,
      label: "org-b-legit",
    });

    // Authenticate in org B; submit BOTH the org-B and the cross-tenant org-A
    // itemId in rekeyedItems.
    const callerB = createOperatorCaller(db, auth, owner.headers, orgB.orgId);
    const result = await callerB.vault.rotateKey({
      wrappedRootKey: "rotated-wrapped-root-key",
      rekeyedItems: [
        {
          itemId: itemB.itemId,
          encryptedItemKey: "new-eik-orgB",
          keyNonce: "new-nonce-orgB",
        },
        {
          itemId: itemA.itemId,
          encryptedItemKey: "HIJACKED-eik",
          keyNonce: "HIJACKED-nonce",
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.keyVersion).toBe(2);

    // Org-A item MUST be unchanged (no cross-org clobber).
    const [itemAAfter] = await db.select().from(items).where(eq(items.id, itemA.itemId)).limit(1);
    expect(itemAAfter?.encryptedItemKey).toBe(itemA.encryptedItemKey);
    expect(itemAAfter?.keyNonce).toBe(itemA.keyNonce);
    expect(itemAAfter?.cryptoVersion).toBe(1);

    // Org-B item was legitimately rotated.
    const [itemBAfter] = await db.select().from(items).where(eq(items.id, itemB.itemId)).limit(1);
    expect(itemBAfter?.encryptedItemKey).toBe("new-eik-orgB");
    expect(itemBAfter?.keyNonce).toBe("new-nonce-orgB");
    expect(itemBAfter?.cryptoVersion).toBe(2);
  });
});

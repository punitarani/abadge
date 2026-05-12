import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { permissions } from "@abadge/db/schema";
import { seedAgent, seedOrg, seedProfile, seedServerItem, seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

// §RM-PR1 — A permission targets EXACTLY one of (item, profile). Both-set
// and both-null rows are illegal at the storage layer, and (agent, profile,
// capability) is unique-per-row just like (agent, item, capability).

// PG error codes used in assertions below:
//   23514 = check_violation
//   23505 = unique_violation
type PgError = { code?: string };

function pgErrorCode(err: unknown): string | undefined {
  return (err as { cause?: PgError }).cause?.code ?? (err as PgError).code;
}

async function expectPgError(promise: () => Promise<unknown>, code: string): Promise<void> {
  let caught: unknown;
  try {
    await promise();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeDefined();
  expect(pgErrorCode(caught)).toBe(code);
}

describe("permissions exactly-one-target constraint", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("rejects rows that set both itemId and profileId", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      authMethod: "legacy_api_key",
    });
    const profile = await seedProfile(db, org.orgId);
    const item = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      profileId: profile.profileId,
    });

    await expectPgError(
      () =>
        db.insert(permissions).values({
          id: crypto.randomUUID(),
          organizationId: org.orgId,
          agentId: agent.agentId,
          itemId: item.itemId,
          profileId: profile.profileId,
          capability: "reveal_plaintext",
          grantedBy: owner.userId,
        }),
      "23514",
    );
  });

  test("rejects rows that leave both itemId and profileId NULL", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      authMethod: "legacy_api_key",
    });

    await expectPgError(
      () =>
        db.insert(permissions).values({
          id: crypto.randomUUID(),
          organizationId: org.orgId,
          agentId: agent.agentId,
          itemId: null,
          profileId: null,
          capability: "reveal_plaintext",
          grantedBy: owner.userId,
        }),
      "23514",
    );
  });

  test("rejects duplicate (agent, profile, capability) rows", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      authMethod: "legacy_api_key",
    });
    const profile = await seedProfile(db, org.orgId);

    await db.insert(permissions).values({
      id: crypto.randomUUID(),
      organizationId: org.orgId,
      agentId: agent.agentId,
      itemId: null,
      profileId: profile.profileId,
      capability: "reveal_plaintext",
      grantedBy: owner.userId,
    });

    await expectPgError(
      () =>
        db.insert(permissions).values({
          id: crypto.randomUUID(),
          organizationId: org.orgId,
          agentId: agent.agentId,
          itemId: null,
          profileId: profile.profileId,
          capability: "reveal_plaintext",
          grantedBy: owner.userId,
        }),
      "23505",
    );
  });

  test("allows item-target and profile-target rows for the same (agent, capability)", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      authMethod: "legacy_api_key",
    });
    const profile = await seedProfile(db, org.orgId);
    const item = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      profileId: profile.profileId,
    });

    // Item-target grant
    await db.insert(permissions).values({
      id: crypto.randomUUID(),
      organizationId: org.orgId,
      agentId: agent.agentId,
      itemId: item.itemId,
      profileId: null,
      capability: "reveal_plaintext",
      grantedBy: owner.userId,
    });

    // Profile-target grant with the same capability — must coexist because
    // the two unique indexes are partial and target disjoint row sets.
    await db.insert(permissions).values({
      id: crypto.randomUUID(),
      organizationId: org.orgId,
      agentId: agent.agentId,
      itemId: null,
      profileId: profile.profileId,
      capability: "reveal_plaintext",
      grantedBy: owner.userId,
    });
  });
});

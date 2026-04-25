/**
 * Integration tests for the new-user dead-end bugs:
 *
 * §ON5 — organizations.create hardcoded storageMode: "zero_knowledge" at the
 *         profile INSERT, ignoring the caller's choice.
 * §ON5b — the same INSERT omitted wrappedRootKey/kdfSalt/kdfParams for ZK,
 *          leaving the profile structurally unusable.
 * §ON6 — createPersonalOrgForUser seeding helper. Historically this was wired
 *         to Better Auth's user.create.after hook to guarantee every signup
 *         landed with one org; the AGENTS.md invariant has since been relaxed
 *         and onboarding is user-driven via /onboarding + /join. The function
 *         is retained as an explicit seeding helper (tests + admin scripts)
 *         and the test below pins its core invariant.
 */

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createPersonalOrgForUser } from "@abadge/auth";
import { eq } from "@abadge/db";
import { member, organization, profiles } from "@abadge/db/schema";
import { seedOrg, seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

describe("new-user flow (§ON5 §ON5b §ON6)", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  // ---------------------------------------------------------------------------
  // §ON6 — createPersonalOrgForUser creates exactly 1 org + 1 profile
  // ---------------------------------------------------------------------------

  test("§ON6 — createPersonalOrgForUser seeds 1 org + server_managed profile for a fresh user", async () => {
    // seedUser inserts the user row via testUtils (raw adapter insert). The
    // function is no longer wired to any Better Auth hook; it is exercised
    // here to pin the seeding contract for tests and admin scripts that
    // still depend on it.
    const seedResult = await seedUser(auth);

    await createPersonalOrgForUser(db, {
      id: seedResult.userId,
      email: seedResult.email,
      name: seedResult.name,
    });

    const memberships = await db.select().from(member).where(eq(member.userId, seedResult.userId));
    expect(memberships).toHaveLength(1);

    const firstMembership = memberships[0];
    expect(firstMembership).toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: asserted defined above
    const orgId = firstMembership!.organizationId;

    const orgs = await db.select().from(organization).where(eq(organization.id, orgId));
    expect(orgs).toHaveLength(1);
    expect(orgs[0]?.name).toContain("workspace");

    const profileRows = await db.select().from(profiles).where(eq(profiles.organizationId, orgId));
    expect(profileRows).toHaveLength(1);
    expect(profileRows[0]?.name).toBe("internal");
    expect(profileRows[0]?.storageMode).toBe("server_managed");
    // server_managed profiles must not have ZK key material.
    expect(profileRows[0]?.wrappedRootKey).toBeFalsy();
  });

  // ---------------------------------------------------------------------------
  // §ON5 — organizations.create with storageMode: server_managed
  // ---------------------------------------------------------------------------

  test("§ON5 — organizations.create with storageMode='server_managed' creates a server_managed profile", async () => {
    const user = await seedUser(auth);
    const bootstrap = await seedOrg(auth, user.userId);
    const caller = createOperatorCaller(db, auth, user.headers, bootstrap.orgId);

    const result = await caller.organizations.create({
      name: "SM Workspace",
      slug: `sm-ws-${crypto.randomUUID().slice(0, 6)}`,
      storageMode: "server_managed",
    });

    const profileRows = await db
      .select()
      .from(profiles)
      .where(eq(profiles.organizationId, result.organization.id));

    const internal = profileRows.find((p) => p.name === "internal");
    expect(internal).toBeDefined();
    expect(internal?.storageMode).toBe("server_managed");
    expect(internal?.wrappedRootKey).toBeFalsy();
  });

  test("§ON5 — organizations.create without explicit storageMode defaults to server_managed", async () => {
    const user = await seedUser(auth);
    const bootstrap = await seedOrg(auth, user.userId);
    const caller = createOperatorCaller(db, auth, user.headers, bootstrap.orgId);

    const result = await caller.organizations.create({
      name: "Default SM",
      slug: `default-sm-${crypto.randomUUID().slice(0, 6)}`,
    });

    const profileRows = await db
      .select()
      .from(profiles)
      .where(eq(profiles.organizationId, result.organization.id));

    const internal = profileRows.find((p) => p.name === "internal");
    expect(internal?.storageMode).toBe("server_managed");
  });

  // ---------------------------------------------------------------------------
  // §ON5b — organizations.create with storageMode: zero_knowledge
  // ---------------------------------------------------------------------------

  test("§ON5b — organizations.create with storageMode='zero_knowledge' without KDF fields → validation error", async () => {
    const user = await seedUser(auth);
    const bootstrap = await seedOrg(auth, user.userId);
    const caller = createOperatorCaller(db, auth, user.headers, bootstrap.orgId);

    // biome-ignore lint/suspicious/noExplicitAny: intentionally omitting required ZK fields to test validation
    const badInput: any = {
      name: "Bad ZK",
      slug: `bad-zk-${crypto.randomUUID().slice(0, 6)}`,
      storageMode: "zero_knowledge",
    };
    await expect(caller.organizations.create(badInput)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  test("§ON5b — organizations.create with storageMode='zero_knowledge' + KDF fields succeeds and stores them", async () => {
    const user = await seedUser(auth);
    const bootstrap = await seedOrg(auth, user.userId);
    const caller = createOperatorCaller(db, auth, user.headers, bootstrap.orgId);

    const result = await caller.organizations.create({
      name: "ZK Workspace",
      slug: `zk-ws-${crypto.randomUUID().slice(0, 6)}`,
      storageMode: "zero_knowledge",
      wrappedRootKey: "wrapped-root-key-base64",
      kdfSalt: "salt-base64",
      kdfParams: {
        algorithm: "argon2id",
        memory: 65536,
        iterations: 3,
        parallelism: 1,
        hashLength: 32,
      },
    });

    const profileRows = await db
      .select()
      .from(profiles)
      .where(eq(profiles.organizationId, result.organization.id));

    const internal = profileRows.find((p) => p.name === "internal");
    expect(internal).toBeDefined();
    expect(internal?.storageMode).toBe("zero_knowledge");
    expect(internal?.wrappedRootKey).toBe("wrapped-root-key-base64");
    expect(internal?.kdfSalt).toBe("salt-base64");
    expect(internal?.kdfParams).toMatchObject({
      algorithm: "argon2id",
      memory: 65536,
      iterations: 3,
      parallelism: 1,
      hashLength: 32,
    });
  });

  test("§ON5b — organizations.create with zero_knowledge + recoveryWrappedRootKey stores it too", async () => {
    const user = await seedUser(auth);
    const bootstrap = await seedOrg(auth, user.userId);
    const caller = createOperatorCaller(db, auth, user.headers, bootstrap.orgId);

    const result = await caller.organizations.create({
      name: "ZK With Recovery",
      slug: `zk-rec-${crypto.randomUUID().slice(0, 6)}`,
      storageMode: "zero_knowledge",
      wrappedRootKey: "wrapped-root-key-base64",
      kdfSalt: "salt-base64",
      kdfParams: {
        algorithm: "argon2id",
        memory: 65536,
        iterations: 3,
        parallelism: 1,
        hashLength: 32,
      },
      recoveryWrappedRootKey: "recovery-key-base64",
    });

    const profileRows = await db
      .select()
      .from(profiles)
      .where(eq(profiles.organizationId, result.organization.id));

    const internal = profileRows.find((p) => p.name === "internal");
    expect(internal?.recoveryWrappedRootKey).toBe("recovery-key-base64");
  });
});

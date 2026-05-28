/**
 * Integration coverage for `organizations.createPersonal` — the one-click
 * personal-account onboarding path. A personal account is a hidden personal
 * org (flagged via `organization.metadata`) seeded with a single
 * server_managed "default" profile, reusing the shared `seedOrgWithOwnerProfile`
 * builder. Personal users can still create/join team orgs later; coexistence
 * rides on the existing X-Abadge-Org-Id resolution.
 */

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { isPersonalOrg } from "@abadge/core";
import { and, eq } from "@abadge/db";
import { auditLogs, member, organization, profiles } from "@abadge/db/schema";
import { seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

describe("organizations.createPersonal", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("seeds a personal org + owner member + default server_managed profile for a fresh user", async () => {
    const user = await seedUser(auth, { name: "Dana Scully" });
    // A fresh user has zero orgs — no org header is sent.
    const caller = createOperatorCaller(db, auth, user.headers);

    const result = await caller.organizations.createPersonal();

    expect(result.organization.isPersonal).toBe(true);
    expect(result.organization.name).toBe("Dana Scully's workspace");
    expect(result.defaultProfile.name).toBe("default");
    expect(result.defaultProfile.externalId).toBe("default");
    expect(result.defaultProfile.storageMode).toBe("server_managed");

    // Caller is registered as the owner.
    const [ownerMember] = await db
      .select()
      .from(member)
      .where(eq(member.organizationId, result.organization.id))
      .limit(1);
    expect(ownerMember?.userId).toBe(user.userId);
    expect(ownerMember?.role).toBe("owner");

    // The org row is flagged personal via metadata (no dedicated column).
    const [orgRow] = await db
      .select()
      .from(organization)
      .where(eq(organization.id, result.organization.id))
      .limit(1);
    expect(isPersonalOrg(orgRow?.metadata)).toBe(true);

    // Exactly one auto-seeded server_managed "default" profile.
    const profileRows = await db
      .select()
      .from(profiles)
      .where(eq(profiles.organizationId, result.organization.id));
    expect(profileRows).toHaveLength(1);
    expect(profileRows[0]?.id).toBe(result.defaultProfile.id);
    expect(profileRows[0]?.name).toBe("default");
    expect(profileRows[0]?.externalId).toBe("default");
    expect(profileRows[0]?.storageMode).toBe("server_managed");
    expect(profileRows[0]?.keyVersion).toBe(1);

    // Audit row carries personal + autoDefaultProfile metadata.
    const auditRows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, result.organization.id),
          eq(auditLogs.eventType, "org.create"),
        ),
      );
    expect(auditRows).toHaveLength(1);
    const meta = auditRows[0]?.meta as { personal?: boolean; autoDefaultProfile?: string } | null;
    expect(meta?.personal).toBe(true);
    expect(meta?.autoDefaultProfile).toBe(result.defaultProfile.id);
  });

  test("falls back to 'Personal workspace' when the user has no name", async () => {
    const user = await seedUser(auth, { name: "" });
    const caller = createOperatorCaller(db, auth, user.headers);

    const result = await caller.organizations.createPersonal();
    expect(result.organization.name).toBe("Personal workspace");
    expect(result.organization.isPersonal).toBe(true);
  });

  test("list surfaces isPersonal + hasBootstrappedProfile for the personal org", async () => {
    const user = await seedUser(auth);
    const caller = createOperatorCaller(db, auth, user.headers);
    const created = await caller.organizations.createPersonal();

    const list = await caller.organizations.list();
    expect(list.organizations).toHaveLength(1);
    const org = list.organizations[0];
    expect(org?.id).toBe(created.organization.id);
    expect(org?.isPersonal).toBe(true);
    // The seeded server_managed profile makes the org immediately usable.
    expect(org?.hasBootstrappedProfile).toBe(true);
  });

  test("repeated personal creation yields distinct unique slugs (no SLUG_TAKEN surfaced)", async () => {
    const user = await seedUser(auth, { name: "Same Name" });

    // First call: zero orgs, header-less.
    const first = await createOperatorCaller(db, auth, user.headers).organizations.createPersonal();
    // Second call: one membership now; userProcedure auto-resolves it. The
    // random slug suffix must keep the two orgs distinct without erroring.
    const second = await createOperatorCaller(
      db,
      auth,
      user.headers,
      first.organization.id,
    ).organizations.createPersonal();

    expect(second.organization.id).not.toBe(first.organization.id);
    expect(second.organization.slug).not.toBe(first.organization.slug);
  });

  test("coexistence — a personal user can also create a team org; list flags each correctly", async () => {
    const user = await seedUser(auth);

    const personal = await createOperatorCaller(
      db,
      auth,
      user.headers,
    ).organizations.createPersonal();

    // Pin the header to the personal org to create a second (team) org.
    const team = await createOperatorCaller(
      db,
      auth,
      user.headers,
      personal.organization.id,
    ).organizations.create({ name: "Team Co", slug: `team-${crypto.randomUUID().slice(0, 8)}` });
    expect(team.organization.isPersonal).toBe(false);

    const list = (await createOperatorCaller(
      db,
      auth,
      user.headers,
      personal.organization.id,
    ).organizations.list()) as { organizations: Array<{ id: string; isPersonal: boolean }> };
    expect(list.organizations).toHaveLength(2);
    const byId = new Map(list.organizations.map((o) => [o.id, o] as const));
    expect(byId.get(personal.organization.id)?.isPersonal).toBe(true);
    expect(byId.get(team.organization.id)?.isPersonal).toBe(false);
  });

  test("coexistence — once a user has 2 orgs, a scoped call without an org header is rejected", async () => {
    const user = await seedUser(auth);
    const personal = await createOperatorCaller(
      db,
      auth,
      user.headers,
    ).organizations.createPersonal();
    await createOperatorCaller(
      db,
      auth,
      user.headers,
      personal.organization.id,
    ).organizations.create({ name: "Team Co", slug: `team-${crypto.randomUUID().slice(0, 8)}` });

    // No header + 2 memberships → session resolution rejects before the handler.
    const headerless = createOperatorCaller(db, auth, user.headers);
    try {
      await headerless.organizations.get({ orgId: personal.organization.id });
      expect.unreachable("expected ORG_HEADER_REQUIRED for a multi-org user without a header");
    } catch (error: unknown) {
      const err = error as { cause?: { code?: string } };
      expect(err.cause?.code).toBe("ORG_HEADER_REQUIRED");
    }

    // With the personal-org header, the same scoped call resolves and the org
    // comes back flagged personal.
    const scoped = createOperatorCaller(db, auth, user.headers, personal.organization.id);
    const got = await scoped.organizations.get({ orgId: personal.organization.id });
    expect(got.organization.isPersonal).toBe(true);
  });
});

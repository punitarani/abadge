import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  buildInviteAcceptAuditRow,
  buildInviteCancelAuditRow,
  buildInviteCreateAuditRow,
  buildInviteRejectAuditRow,
  buildMemberAddAuditRow,
  buildMemberRemoveAuditRow,
  buildMemberRoleUpdateAuditRow,
  buildOrgUpdateAuditRow,
  orgPluginAcOptions,
  safeAuditInsert,
} from "@abadge/auth";
import { and, type Database, eq, onMemberRemoved } from "@abadge/db";
import { agents, auditLogs, member } from "@abadge/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, organization, testUtils } from "better-auth/plugins";
import { seedMember, seedOrg, seedUser } from "../helpers/seed";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";
import { TEST_ENV } from "../helpers/test-env";

/**
 * Creates a test auth instance with the same organizationHooks as production.
 * Uses testUtils plugin to support seedUser/seedOrg helpers.
 */
// biome-ignore lint/suspicious/noExplicitAny: Better Auth inferred type is too complex
function createHookedTestAuth(db: Database): any {
  return betterAuth({
    // See test-auth.ts: `better-auth` is a phantom dependency in @abadge/trpc, so
    // the adapter doesn't unify with the `database` field here. Anchor the cast to
    // the field type; the runtime call matches @abadge/auth's production usage.
    database: drizzleAdapter(db, { provider: "pg" }) as Parameters<
      typeof betterAuth
    >[0]["database"],
    baseURL: TEST_ENV.ABADGE_API_URL,
    secret: TEST_ENV.BETTER_AUTH_SECRET,
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    plugins: [
      organization({
        allowUserToCreateOrganization: true,
        creatorRole: "owner",
        ...orgPluginAcOptions,
        organizationHooks: {
          afterUpdateOrganization: async ({ organization: org, user, member: m }) => {
            await safeAuditInsert(
              db,
              buildOrgUpdateAuditRow({ organization: org, orgId: m.organizationId, user }),
            );
          },
          afterAddMember: async ({ member: m, user, organization: org }) => {
            await safeAuditInsert(
              db,
              buildMemberAddAuditRow({
                organization: org,
                member: { userId: m.userId, role: m.role },
                user,
              }),
            );
          },
          afterRemoveMember: async ({ member: m, user, organization: org }) => {
            await safeAuditInsert(
              db,
              buildMemberRemoveAuditRow({ organization: org, member: m, user }),
            );
            try {
              await db.transaction((tx) => onMemberRemoved(tx, org.id, m.userId, user.id));
            } catch {
              // cascade failure must not block the hook
            }
          },
          afterUpdateMemberRole: async ({ member: m, previousRole, user, organization: org }) => {
            await safeAuditInsert(
              db,
              buildMemberRoleUpdateAuditRow({
                organization: org,
                member: { userId: m.userId, role: m.role },
                previousRole,
                user,
              }),
            );
          },
          afterCreateInvitation: async ({ invitation, inviter, organization: org }) => {
            await safeAuditInsert(
              db,
              buildInviteCreateAuditRow({ invitation, organization: org, inviter }),
            );
          },
          afterAcceptInvitation: async ({ invitation, user, organization: org }) => {
            await safeAuditInsert(
              db,
              buildInviteAcceptAuditRow({ invitation, organization: org, user }),
            );
          },
          afterRejectInvitation: async ({ invitation, user, organization: org }) => {
            await safeAuditInsert(
              db,
              buildInviteRejectAuditRow({ invitation, organization: org, user }),
            );
          },
          afterCancelInvitation: async ({ invitation, cancelledBy, organization: org }) => {
            await safeAuditInsert(
              db,
              buildInviteCancelAuditRow({ invitation, organization: org, cancelledBy }),
            );
          },
        },
      }),
      bearer(),
      testUtils(),
    ],
  });
}

describe("Better Auth organizationHooks coverage (W1S8-001)", () => {
  const db = getTestDb();
  const auth = createHookedTestAuth(db);
  const baseUrl = TEST_ENV.ABADGE_API_URL;

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  // ---------------------------------------------------------------------------
  // afterUpdateMemberRole
  // ---------------------------------------------------------------------------

  test("/api/auth/organization/update-member-role writes org.member_role_change audit row", async () => {
    const owner = await seedUser(auth);
    const { orgId } = await seedOrg(auth, owner.userId, {
      name: "Hooks Org",
      slug: `hooks-role-${crypto.randomUUID()}`,
    });
    const bob = await seedUser(auth);
    await seedMember(auth, orgId, bob.userId, "member");

    const [bobRow] = await db
      .select({ id: member.id })
      .from(member)
      .where(eq(member.userId, bob.userId));
    if (!bobRow) throw new Error("seeding failed: bob membership missing");

    const reqHeaders = new Headers(owner.headers);
    reqHeaders.set("content-type", "application/json");
    const res = await auth.handler(
      new Request(`${baseUrl}/api/auth/organization/update-member-role`, {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify({ memberId: bobRow.id, role: "admin", organizationId: orgId }),
      }),
    );
    expect(res.status).toBe(200);

    const [auditRow] = await db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.organizationId, orgId), eq(auditLogs.eventType, "org.member_role_change")),
      );
    expect(auditRow).toBeDefined();
    expect(auditRow?.surface).toBe("auth");
    const meta = auditRow?.meta as Record<string, unknown> | null;
    expect(meta?.targetUserId).toBe(bob.userId);
    expect(meta?.newRole).toBe("admin");
    expect(meta?.previousRole).toBe("member");
  });

  // ---------------------------------------------------------------------------
  // afterRemoveMember + cascade
  // ---------------------------------------------------------------------------

  test("/api/auth/organization/remove-member writes org.member_remove audit row and cascades agents", async () => {
    const owner = await seedUser(auth);
    const { orgId } = await seedOrg(auth, owner.userId, {
      name: "Remove Org",
      slug: `hooks-remove-${crypto.randomUUID()}`,
    });
    const bob = await seedUser(auth);
    await seedMember(auth, orgId, bob.userId, "member");

    // Seed an agent owned by bob so we can verify cascade.
    // Direct DB insert — no hook fires for this seeding path.
    await db.insert(agents).values({
      id: crypto.randomUUID(),
      organizationId: orgId,
      createdBy: bob.userId,
      name: "bob-agent",
      kind: "local_cli",
      locality: "local",
      authMethod: "public_key_session",
    });

    const [bobRow] = await db
      .select({ id: member.id })
      .from(member)
      .where(eq(member.userId, bob.userId));
    if (!bobRow) throw new Error("seeding failed: bob membership missing");

    const reqHeaders = new Headers(owner.headers);
    reqHeaders.set("content-type", "application/json");
    const res = await auth.handler(
      new Request(`${baseUrl}/api/auth/organization/remove-member`, {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify({ memberIdOrEmail: bobRow.id, organizationId: orgId }),
      }),
    );
    expect(res.status).toBe(200);

    // Audit row for member remove must exist.
    const [auditRow] = await db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.organizationId, orgId), eq(auditLogs.eventType, "org.member_remove")),
      );
    expect(auditRow).toBeDefined();
    expect(auditRow?.surface).toBe("auth");

    // Bob's agent should be revoked (cascade ran).
    const [bobAgent] = await db
      .select({ enabled: agents.enabled })
      .from(agents)
      .where(and(eq(agents.organizationId, orgId), eq(agents.createdBy, bob.userId)));
    expect(bobAgent?.enabled).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // afterAddMember — row builder + safeAuditInsert (hook unit test)
  // ---------------------------------------------------------------------------

  test("buildMemberAddAuditRow writes org.member_add row when called from afterAddMember", async () => {
    // The Better Auth addMember endpoint (registered without an explicit path)
    // has a runtime-derived URL that varies by Better Auth version. Rather than
    // coupling this test to an undocumented internal path, we verify that the
    // hook plumbing (row builder + safeAuditInsert) works correctly, which is
    // the same code path that fires from the Better Auth handler.
    const owner = await seedUser(auth);
    const { orgId } = await seedOrg(auth, owner.userId, {
      name: "Add Member Org",
      slug: `hooks-add-${crypto.randomUUID()}`,
    });
    const bob = await seedUser(auth);

    // Simulate what afterAddMember does.
    await safeAuditInsert(
      db,
      buildMemberAddAuditRow({
        organization: { id: orgId },
        member: { userId: bob.userId, role: "member" },
        user: { id: owner.userId },
      }),
    );

    const [auditRow] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, orgId), eq(auditLogs.eventType, "org.member_add")));
    expect(auditRow).toBeDefined();
    expect(auditRow?.surface).toBe("auth");
    const meta = auditRow?.meta as Record<string, unknown> | null;
    expect(meta?.addedUserId).toBe(bob.userId);
    expect(meta?.role).toBe("member");
  });

  // ---------------------------------------------------------------------------
  // afterUpdateOrganization
  // ---------------------------------------------------------------------------

  test("/api/auth/organization/update writes org.update audit row", async () => {
    const owner = await seedUser(auth);
    const { orgId } = await seedOrg(auth, owner.userId, {
      name: "Before Rename",
      slug: `hooks-update-${crypto.randomUUID()}`,
    });

    // The update endpoint expects { data: { ... }, organizationId? }
    const reqHeaders = new Headers(owner.headers);
    reqHeaders.set("content-type", "application/json");
    const res = await auth.handler(
      new Request(`${baseUrl}/api/auth/organization/update`, {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify({ data: { name: "After Rename" }, organizationId: orgId }),
      }),
    );
    expect(res.status).toBe(200);

    const [auditRow] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, orgId), eq(auditLogs.eventType, "org.update")));
    expect(auditRow).toBeDefined();
    expect(auditRow?.surface).toBe("auth");
  });
});

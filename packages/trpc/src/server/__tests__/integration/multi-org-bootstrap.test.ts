import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { _resetGetInviteInfoRateLimit } from "../../routers/organizations";
import { seedOrg, seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

/**
 * §ORG2: resolveOptionalOrgId used to throw ORG_HEADER_REQUIRED when a user
 * had >=2 memberships and no X-Abadge-Org-Id header — a bootstrap trap. This
 * suite proves the fix: multi-org users can call userProcedure routes without
 * an explicit org header.
 *
 * §I4: getInviteInfo and acceptInvite were wired to sessionProcedure, blocking
 * 0-membership invitees from accepting invitations. Proved here with the
 * end-to-end invite flow.
 */

describe("multi-org bootstrap trap (§ORG2)", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("user with 2 orgs can call organizations.list WITHOUT X-Abadge-Org-Id", async () => {
    const user = await seedUser(auth);
    await seedOrg(auth, user.userId, {
      name: "Alpha",
      slug: `alpha-${crypto.randomUUID().slice(0, 8)}`,
    });
    await seedOrg(auth, user.userId, {
      name: "Beta",
      slug: `beta-${crypto.randomUUID().slice(0, 8)}`,
    });

    // No orgId — this was the trigger for ORG_HEADER_REQUIRED before the fix.
    const caller = createOperatorCaller(db, auth, user.headers);

    const result = await caller.organizations.list();
    expect(result.organizations).toHaveLength(2);
  });

  test("user with 2 orgs can call organizations.create WITHOUT X-Abadge-Org-Id", async () => {
    const user = await seedUser(auth);
    await seedOrg(auth, user.userId, {
      name: "Alpha",
      slug: `alpha-${crypto.randomUUID().slice(0, 8)}`,
    });
    await seedOrg(auth, user.userId, {
      name: "Beta",
      slug: `beta-${crypto.randomUUID().slice(0, 8)}`,
    });

    const caller = createOperatorCaller(db, auth, user.headers); // no orgId

    const slug = `gamma-${crypto.randomUUID().slice(0, 8)}`;
    const result = await caller.organizations.create({ name: "Gamma", slug });
    expect(result.organization.slug).toBe(slug);
  });

  test("user with 2 orgs can call organizations.checkSlug WITHOUT X-Abadge-Org-Id", async () => {
    const user = await seedUser(auth);
    await seedOrg(auth, user.userId, {
      name: "Alpha",
      slug: `alpha-${crypto.randomUUID().slice(0, 8)}`,
    });
    await seedOrg(auth, user.userId, {
      name: "Beta",
      slug: `beta-${crypto.randomUUID().slice(0, 8)}`,
    });

    const caller = createOperatorCaller(db, auth, user.headers);

    const result = await caller.organizations.checkSlug({
      slug: `brand-new-${crypto.randomUUID().slice(0, 8)}`,
    });
    expect(result.available).toBe(true);
  });

  test("user with 2 orgs CAN still pass X-Abadge-Org-Id explicitly (unchanged path)", async () => {
    const user = await seedUser(auth);
    const alpha = await seedOrg(auth, user.userId, {
      name: "Alpha",
      slug: `alpha-${crypto.randomUUID().slice(0, 8)}`,
    });
    await seedOrg(auth, user.userId, {
      name: "Beta",
      slug: `beta-${crypto.randomUUID().slice(0, 8)}`,
    });

    const caller = createOperatorCaller(db, auth, user.headers, alpha.orgId);

    const result = await caller.organizations.list();
    expect(result.organizations).toHaveLength(2);
  });
});

describe("invite accept by 0-membership user (§I4)", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    _resetGetInviteInfoRateLimit();
    await truncateAll();
  });

  test("fresh 0-membership user can getInviteInfo + acceptInvite", async () => {
    // Owner creates org + invites an unrelated user.
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId, {
      name: "Host",
      slug: `host-${crypto.randomUUID().slice(0, 8)}`,
    });
    // Owner has exactly one org → auto-resolved; orgId explicit for invite (sessionProcedure).
    const ownerCaller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const invite = await ownerCaller.organizations.members.invite({
      orgId: org.orgId,
      role: "member",
    });
    expect(invite.token).toBeTruthy();

    // Fresh user signs up — zero memberships.
    const invitee = await seedUser(auth);
    // No orgId: 0-membership user, userProcedure must not require one.
    const inviteeCaller = createOperatorCaller(db, auth, invitee.headers);

    // getInviteInfo must succeed without org context.
    const info = await inviteeCaller.organizations.members.getInviteInfo({
      token: invite.token,
    });
    expect(info.organizationName).toBe("Host");
    expect(info.role).toBe("member");

    // acceptInvite must succeed without org context.
    const accept = await inviteeCaller.organizations.members.acceptInvite({
      token: invite.token,
    });
    expect(accept.ok).toBe(true);
    expect(accept.organizationId).toBe(org.orgId);

    // Invitee now has 1 membership and can list orgs.
    const listResult = await inviteeCaller.organizations.list();
    expect(listResult.organizations).toHaveLength(1);
    expect(listResult.organizations[0]?.id).toBe(org.orgId);
  });
});

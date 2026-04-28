import { describe, expect, it } from "bun:test";
import {
  buildInviteAcceptAuditRow,
  buildInviteCancelAuditRow,
  buildInviteCreateAuditRow,
  buildInviteRejectAuditRow,
  buildMemberAddAuditRow,
  buildMemberRemoveAuditRow,
  buildMemberRoleUpdateAuditRow,
  buildOrgCreateAuditRow,
  buildOrgDeleteAuditRow,
  buildOrgUpdateAuditRow,
  safeAuditInsert,
} from "./audit-hooks";

const ORG = { id: "org_123", slug: "acme" };
const USER = { id: "user_456" };

describe("buildOrgCreateAuditRow", () => {
  it("maps organization and user fields to the expected audit row shape", () => {
    const row = buildOrgCreateAuditRow({ organization: ORG, user: USER });

    expect(row.organizationId).toBe("org_123");
    expect(row.userId).toBe("user_456");
    expect(row.eventType).toBe("org.create");
    expect(row.result).toBe("allowed");
    expect(row.surface).toBe("auth");
    expect(row.ipAddress).toBeNull();
  });

  it("includes source and slug in meta", () => {
    const row = buildOrgCreateAuditRow({ organization: ORG, user: USER });
    expect(row.meta).toEqual({ source: "better_auth_plugin", slug: "acme" });
  });

  it("handles null slug gracefully", () => {
    const row = buildOrgCreateAuditRow({
      organization: { id: "org_123", slug: null },
      user: USER,
    });
    expect(row.meta).toEqual({ source: "better_auth_plugin", slug: null });
  });

  it("handles undefined slug gracefully", () => {
    const row = buildOrgCreateAuditRow({
      organization: { id: "org_123" },
      user: USER,
    });
    expect(row.meta).toEqual({ source: "better_auth_plugin", slug: null });
  });
});

describe("buildOrgDeleteAuditRow", () => {
  it("maps organization and user fields to the expected audit row shape", () => {
    const row = buildOrgDeleteAuditRow({ organization: ORG, user: USER });

    expect(row.organizationId).toBe("org_123");
    expect(row.userId).toBe("user_456");
    expect(row.eventType).toBe("org.delete");
    expect(row.result).toBe("allowed");
    expect(row.surface).toBe("auth");
    expect(row.ipAddress).toBeNull();
  });

  it("includes source and slug in meta", () => {
    const row = buildOrgDeleteAuditRow({ organization: ORG, user: USER });
    expect(row.meta).toEqual({ source: "better_auth_plugin", slug: "acme" });
  });
});

describe("buildOrgUpdateAuditRow", () => {
  it("maps fields when organization row is present", () => {
    const row = buildOrgUpdateAuditRow({
      organization: { id: "org_123", slug: "acme", name: "Acme" },
      orgId: "org_123",
      user: USER,
    });
    expect(row.eventType).toBe("org.update");
    expect(row.organizationId).toBe("org_123");
    expect(row.meta).toEqual({
      source: "better_auth_plugin",
      slug: "acme",
      name: "Acme",
    });
  });

  it("falls back to context orgId when adapter returned null", () => {
    const row = buildOrgUpdateAuditRow({
      organization: null,
      orgId: "org_fallback",
      user: USER,
    });
    expect(row.organizationId).toBe("org_fallback");
    expect(row.meta).toEqual({
      source: "better_auth_plugin",
      slug: null,
      name: null,
    });
  });
});

describe("buildMemberAddAuditRow", () => {
  it("emits org.member_add with caller as actor and added user/role in meta", () => {
    const row = buildMemberAddAuditRow({
      organization: { id: "org_123" },
      member: { userId: "u_added", role: "admin" },
      user: USER,
    });
    expect(row.eventType).toBe("org.member_add");
    expect(row.userId).toBe("user_456"); // caller
    expect(row.meta).toEqual({
      source: "better_auth_plugin",
      addedUserId: "u_added",
      role: "admin",
    });
  });
});

describe("buildMemberRemoveAuditRow", () => {
  it("emits org.member_remove with the removed user in meta (caller not exposed)", () => {
    const row = buildMemberRemoveAuditRow({
      organization: { id: "org_123" },
      member: { userId: "u_removed" },
      user: { id: "u_removed" },
    });
    expect(row.eventType).toBe("org.member_remove");
    expect(row.userId).toBe("u_removed");
    expect(row.meta).toEqual({
      source: "better_auth_plugin",
      removedUserId: "u_removed",
    });
  });
});

describe("buildMemberRoleUpdateAuditRow", () => {
  it("emits org.member_role_change carrying previous and new roles", () => {
    const row = buildMemberRoleUpdateAuditRow({
      organization: { id: "org_123" },
      member: { userId: "u_target", role: "admin" },
      previousRole: "member",
      user: USER,
    });
    expect(row.eventType).toBe("org.member_role_change");
    expect(row.userId).toBe("user_456");
    expect(row.meta).toEqual({
      source: "better_auth_plugin",
      targetUserId: "u_target",
      previousRole: "member",
      newRole: "admin",
    });
  });
});

describe("buildInviteCreateAuditRow", () => {
  it("emits org.invite with inviter as actor", () => {
    const row = buildInviteCreateAuditRow({
      invitation: { id: "inv_1", role: "admin" },
      organization: { id: "org_123" },
      inviter: { id: "user_inv" },
    });
    expect(row.eventType).toBe("org.invite");
    expect(row.userId).toBe("user_inv");
    expect(row.meta).toEqual({
      source: "better_auth_plugin",
      invitationId: "inv_1",
      role: "admin",
    });
  });
});

describe("buildInviteAcceptAuditRow", () => {
  it("emits org.invite_accept with the accepting user as actor", () => {
    const row = buildInviteAcceptAuditRow({
      invitation: { id: "inv_1" },
      organization: { id: "org_123" },
      user: { id: "user_invitee" },
    });
    expect(row.eventType).toBe("org.invite_accept");
    expect(row.result).toBe("allowed");
    expect(row.userId).toBe("user_invitee");
    expect(row.meta).toEqual({
      source: "better_auth_plugin",
      invitationId: "inv_1",
    });
  });
});

describe("buildInviteRejectAuditRow", () => {
  it("emits org.invite_reject with result=denied", () => {
    const row = buildInviteRejectAuditRow({
      invitation: { id: "inv_1" },
      organization: { id: "org_123" },
      user: { id: "user_invitee" },
    });
    expect(row.eventType).toBe("org.invite_reject");
    expect(row.result).toBe("denied");
    expect(row.userId).toBe("user_invitee");
    expect(row.meta).toEqual({
      source: "better_auth_plugin",
      invitationId: "inv_1",
    });
  });
});

describe("buildInviteCancelAuditRow", () => {
  it("emits org.invite_revoke with cancelledBy as actor", () => {
    const row = buildInviteCancelAuditRow({
      invitation: { id: "inv_1" },
      organization: { id: "org_123" },
      cancelledBy: { id: "user_admin" },
    });
    expect(row.eventType).toBe("org.invite_revoke");
    expect(row.userId).toBe("user_admin");
    expect(row.meta).toEqual({
      source: "better_auth_plugin",
      invitationId: "inv_1",
    });
  });
});

describe("safeAuditInsert", () => {
  it("forwards the insert to the db when no error", async () => {
    const calls: unknown[] = [];
    const fakeDb = {
      insert: () => ({
        values: async (v: unknown) => {
          calls.push(v);
        },
      }),
    } as unknown as Parameters<typeof safeAuditInsert>[0];

    await safeAuditInsert(fakeDb, {
      organizationId: "org_123",
      userId: "user_456",
      eventType: "org.create",
      result: "allowed",
      ipAddress: null,
      surface: "auth",
      meta: {},
    });
    expect(calls).toHaveLength(1);
  });

  it("swallows db errors instead of throwing", async () => {
    const fakeDb = {
      insert: () => ({
        values: async () => {
          throw new Error("db down");
        },
      }),
    } as unknown as Parameters<typeof safeAuditInsert>[0];

    // Must not throw — auditing failures are silent on purpose.
    await safeAuditInsert(fakeDb, {
      organizationId: "org_123",
      userId: "user_456",
      eventType: "org.create",
      result: "allowed",
      ipAddress: null,
      surface: "auth",
      meta: {},
    });
  });
});

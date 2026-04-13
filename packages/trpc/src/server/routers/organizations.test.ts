import { describe, expect, test } from "bun:test";
import { ForbiddenError } from "@abadge/core";
import { requireOrgRole, roleRank } from "../init";
import { organizationsRouter } from "./organizations";

// ---------------------------------------------------------------------------
// roleRank
// ---------------------------------------------------------------------------

describe("roleRank", () => {
  test("owner outranks admin", () => {
    expect(roleRank("owner")).toBeGreaterThan(roleRank("admin"));
  });

  test("admin outranks member", () => {
    expect(roleRank("admin")).toBeGreaterThan(roleRank("member"));
  });

  test("unknown role has rank 0", () => {
    expect(roleRank("stranger")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// requireOrgRole
// ---------------------------------------------------------------------------

function makeRoleMockDb(role: string | null) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.from = () => chain;
  chain.where = () => chain;
  chain.limit = () => Promise.resolve(role !== null ? [{ role }] : []);
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  return chain as any;
}

describe("requireOrgRole", () => {
  test("throws ForbiddenError when caller is not a member", async () => {
    const db = makeRoleMockDb(null);
    await expect(requireOrgRole(db, "org-1", "user-1", "member")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  test("throws ForbiddenError when caller role is insufficient", async () => {
    const db = makeRoleMockDb("member");
    await expect(requireOrgRole(db, "org-1", "user-1", "admin")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  test("resolves with the role when caller has exact minimum role", async () => {
    const db = makeRoleMockDb("admin");
    const role = await requireOrgRole(db, "org-1", "user-1", "admin");
    expect(role).toBe("admin");
  });

  test("resolves when caller has a higher role than required", async () => {
    const db = makeRoleMockDb("owner");
    const role = await requireOrgRole(db, "org-1", "user-1", "member");
    expect(role).toBe("owner");
  });
});

// ---------------------------------------------------------------------------
// Router surface
// ---------------------------------------------------------------------------

describe("organizationsRouter public surface", () => {
  test("exposes expected top-level procedures", () => {
    const procedures = Object.keys(organizationsRouter._def.procedures);
    expect(procedures).toContain("create");
    expect(procedures).toContain("list");
    expect(procedures).toContain("get");
    expect(procedures).toContain("update");
    expect(procedures).toContain("delete");
  });

  test("exposes nested members procedures", () => {
    const procedures = Object.keys(organizationsRouter._def.procedures);
    expect(procedures).toContain("members.list");
    expect(procedures).toContain("members.invite");
    expect(procedures).toContain("members.getInviteInfo");
    expect(procedures).toContain("members.acceptInvite");
    expect(procedures).toContain("members.revokeInvite");
    expect(procedures).toContain("members.remove");
    expect(procedures).toContain("members.updateRole");
  });
});

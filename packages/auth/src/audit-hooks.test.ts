import { describe, expect, it } from "bun:test";
import { buildOrgCreateAuditRow, buildOrgDeleteAuditRow } from "./audit-hooks";

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

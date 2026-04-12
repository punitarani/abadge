import { describe, expect, test } from "bun:test";
import { AGENT_KINDS } from "@abadge/core";
import { getTableColumns, getTableName } from "drizzle-orm";
import { agents, auditLogs, items, permissions, profiles } from "./index";

describe("roadmap schema foundations", () => {
  test("profiles table matches the new organization-scoped encryption boundary", () => {
    expect(getTableName(profiles)).toBe("profiles");
    expect(Object.keys(getTableColumns(profiles))).toEqual([
      "id",
      "organizationId",
      "name",
      "description",
      "storageMode",
      "wrappedRootKey",
      "kdfSalt",
      "kdfParams",
      "recoveryWrappedRootKey",
      "keyVersion",
      "createdAt",
      "updatedAt",
    ]);
  });

  test("items table carries additive org/profile/label metadata for the v0 cutover", () => {
    const columns = Object.keys(getTableColumns(items));

    expect(columns).toContain("organizationId");
    expect(columns).toContain("profileId");
    expect(columns).toContain("label");
    expect(columns).toContain("kind");
    expect(columns).toContain("tags");
    expect(columns).toContain("userId");
    expect(columns).toContain("vaultId");
  });

  test("agents table is org-scoped and uses the simplified roadmap kinds", () => {
    const columns = getTableColumns(agents);

    expect(getTableName(agents)).toBe("agents");
    expect(Object.keys(columns)).toEqual([
      "id",
      "organizationId",
      "createdBy",
      "name",
      "description",
      "kind",
      "locality",
      "authMethod",
      "secretHash",
      "secretPrefix",
      "publicKey",
      "enabled",
      "revokedAt",
      "lastUsedAt",
      "metadata",
      "createdAt",
    ]);
    expect(columns.kind.enumValues).toEqual(AGENT_KINDS);
  });

  test("permissions table scopes grants to organizations", () => {
    expect(getTableName(permissions)).toBe("permissions");
    expect(Object.keys(getTableColumns(permissions))).toEqual([
      "id",
      "organizationId",
      "agentId",
      "itemId",
      "capability",
      "expiresAt",
      "grantedBy",
      "createdAt",
    ]);
  });

  test("audit logs carry delivery and surface metadata end-to-end", () => {
    expect(getTableName(auditLogs)).toBe("audit_logs");
    expect(Object.keys(getTableColumns(auditLogs))).toEqual([
      "id",
      "organizationId",
      "userId",
      "agentId",
      "itemId",
      "profileId",
      "surface",
      "eventType",
      "result",
      "deliveryMode",
      "field",
      "purpose",
      "meta",
      "ipAddress",
      "occurredAt",
    ]);
  });
});

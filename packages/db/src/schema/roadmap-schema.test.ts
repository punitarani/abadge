import { describe, expect, test } from "bun:test";
import { AGENT_KINDS } from "@abadge/core";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { agents, auditLogs, items, permissions, profiles } from "./index";

describe("roadmap schema foundations", () => {
  test("profiles table matches the new organization-scoped encryption boundary", () => {
    expect(getTableName(profiles)).toBe("profiles");
    expect(Object.keys(getTableColumns(profiles))).toEqual([
      "id",
      "organizationId",
      "name",
      "description",
      // §RM-PR1 — externalId is the optional, caller-supplied idempotency
      // key for API-created profiles; partial-unique per organization.
      "externalId",
      "storageMode",
      "wrappedRootKey",
      "kdfSalt",
      "kdfParams",
      "recoveryWrappedRootKey",
      // §AB-0030 — per-profile server-managed DEK, wrapped under ENCRYPTION_KEY.
      "serverWrappedDek",
      "keyVersion",
      "createdAt",
      "updatedAt",
    ]);
  });

  test("items table carries additive org/profile/label metadata for the v0 cutover", () => {
    const columns = getTableColumns(items);

    expect(Object.keys(columns)).toContain("organizationId");
    expect(Object.keys(columns)).toContain("profileId");
    expect(Object.keys(columns)).toContain("label");
    expect(Object.keys(columns)).toContain("kind");
    expect(Object.keys(columns)).toContain("tags");
    // §RM-PR1 — `userId` → `createdBy`: audit metadata, not ownership.
    expect(Object.keys(columns)).toContain("createdBy");
    expect(Object.keys(columns)).not.toContain("userId");
    expect(Object.keys(columns)).not.toContain("vaultId");
    expect(columns.label.notNull).toBe(true);
    // createdBy is nullable so deleting the user keeps the item alive with
    // a NULL audit trail.
    expect(columns.createdBy.notNull).toBe(false);
  });

  test("items.organization_id is NOT NULL with ON DELETE cascade", () => {
    const columns = getTableColumns(items);

    // Items must belong to an organization — cross-org isolation depends on this.
    expect(columns.organizationId.notNull).toBe(true);

    // FK must cascade: if the org is deleted, its items go with it.
    // ON DELETE SET NULL would orphan items to a NULL-org state that bypasses
    // every `WHERE items.organization_id = ?` filter.
    const { foreignKeys } = getTableConfig(items);
    const orgFk = foreignKeys.find((fk) =>
      fk.reference().columns.some((col) => col.name === "organization_id"),
    );
    expect(orgFk).toBeDefined();
    expect(orgFk?.onDelete).toBe("cascade");
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
    expect([...columns.kind.enumValues]).toEqual([...AGENT_KINDS]);
  });

  test("permissions table scopes grants to organizations", () => {
    expect(getTableName(permissions)).toBe("permissions");
    expect(Object.keys(getTableColumns(permissions))).toEqual([
      "id",
      "organizationId",
      "agentId",
      "itemId",
      // §RM-PR1 — profile-target permissions. The CHECK constraint enforces
      // exactly one of (itemId, profileId) is non-null.
      "profileId",
      "capability",
      "expiresAt",
      "grantedBy",
      "createdAt",
    ]);
  });

  test("audit logs carry delivery and surface metadata end-to-end", () => {
    const columns = getTableColumns(auditLogs);
    const organizationId = columns.organizationId as typeof columns.organizationId & {
      foreignKeyConfigs?: unknown[];
    };
    const profileId = columns.profileId as typeof columns.profileId & {
      foreignKeyConfigs?: unknown[];
    };

    expect(getTableName(auditLogs)).toBe("audit_logs");
    expect(Object.keys(columns)).toEqual([
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
    expect(organizationId.foreignKeyConfigs ?? []).toHaveLength(0);
    expect(profileId.foreignKeyConfigs ?? []).toHaveLength(0);
  });
});

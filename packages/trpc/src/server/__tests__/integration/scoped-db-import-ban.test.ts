import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Glob } from "bun";

// §AB-0010 — the scoped data-access layer is only a backstop if nothing bypasses
// it. The five org-scoped tenant tables must be reached through `scopedDb`, never
// imported directly into a router. This test is the enforcement (the acceptance
// criterion's "CI test scanning imports").
const SERVER_DIR = path.resolve(import.meta.dir, "../..");
const TENANT_TABLES = ["items", "profiles", "agents", "permissions", "auditLogs"] as const;

// Files that still import a tenant table directly, pending migration onto scopedDb.
// §AB-0010 PR-D — every org-scoped-query router (items, agents, permissions,
// access, access/pipeline, audit) now routes tenant-table access through scopedDb.
// The entries below are the DOCUMENTED EXCEPTIONS that legitimately cannot use the
// single-org scope. Any NEW direct tenant-table importer outside this set fails.
const MIGRATION_ALLOWLIST = new Set<string>([
  // Audit-write infrastructure: inserts auditLogs with the org from the validated
  // entry; not a product data-access path. (mirrorAuditRow is log-only.)
  "audit.ts",
  // Agent auth resolution: agent/session lookups, transitively org-scoped via agentId.
  "auth.ts",
  "routers/auth.ts",
  // requireAgentOwnership (agents-by-id+org) + member (non-tenant) queries.
  "init.ts",
  // Cross-org onboarding-status query (inArray over the user's orgIds) cannot be
  // single-org-scoped; the remainder is Better Auth tables.
  "routers/organizations.ts",
  // Role-check + by-PK model: loadProfile fetches by PK then requireOrgRole against
  // the profile's OWN org (deliberately cross-org-membership), not the active org.
  "routers/profiles.ts",
  // Row->wire mapping; references table TYPES ($inferSelect), not queries.
  "serialize.ts",
  // Per-profile DEK envelope (AB-0030): operates by id within an org-resolved request.
  "server-envelope.ts",
]);

function importsTenantTable(source: string): boolean {
  const blocks = source.matchAll(
    /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']@abadge\/db\/schema["']/g,
  );
  for (const m of blocks) {
    const names = m[1] ?? "";
    if (TENANT_TABLES.some((t) => new RegExp(`\\b${t}\\b`).test(names))) return true;
  }
  return false;
}

function serverFilesImportingTenantTables(): string[] {
  const offenders: string[] = [];
  for (const rel of new Glob("**/*.ts").scanSync(SERVER_DIR)) {
    if (rel.includes("__tests__") || rel.endsWith(".test.ts") || rel === "scoped-db.ts") continue;
    if (importsTenantTable(readFileSync(path.join(SERVER_DIR, rel), "utf8"))) offenders.push(rel);
  }
  return offenders.sort();
}

describe("§AB-0010 — tenant tables are reached only through scopedDb", () => {
  test("no server file imports a tenant table directly outside the migration allowlist", () => {
    const offenders = serverFilesImportingTenantTables().filter((f) => !MIGRATION_ALLOWLIST.has(f));
    expect(offenders).toEqual([]);
  });

  test("the migration allowlist has no stale entries", () => {
    const importing = new Set(serverFilesImportingTenantTables());
    const stale = [...MIGRATION_ALLOWLIST].filter((f) => !importing.has(f)).sort();
    expect(stale).toEqual([]);
  });
});

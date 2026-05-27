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
// This is the migration RATCHET: it shrinks as routers move to the scoped layer and
// must be emptied when AB-0010 is complete. A NEW direct importer fails the test.
const MIGRATION_ALLOWLIST = new Set<string>([
  "audit.ts",
  "auth.ts",
  "cascades.ts",
  "init.ts",
  "routers/access.ts",
  "routers/access/pipeline.ts",
  "routers/agents.ts",
  "routers/audit.ts",
  "routers/auth.ts",
  "routers/items.ts",
  "routers/organizations.ts",
  "routers/permissions.ts",
  "routers/profiles.ts",
  "serialize.ts",
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

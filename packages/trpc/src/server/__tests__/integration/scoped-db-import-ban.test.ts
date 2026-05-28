import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Glob } from "bun";

// §AB-0010 — the five org-scoped tenant tables must be reached through `scopedDb`,
// never imported directly into a server file. This CI ratchet is the enforcement
// for that acceptance criterion: a named OR namespace import of the schema barrel's
// tenant tables fails the test unless the file is on the (shrinking) allowlist.
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
  // Named import: flag when a tenant table is among the bindings.
  for (const m of source.matchAll(
    /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']@abadge\/db\/schema["']/g,
  )) {
    if (TENANT_TABLES.some((t) => new RegExp(`\\b${t}\\b`).test(m[1] ?? ""))) return true;
  }
  // Namespace import exposes every table including the tenant ones, so `schema.items`
  // is a bypass by construction — flag it regardless of how the binding is later used.
  return /import\s*(?:type\s*)?\*\s*as\s+\w+\s*from\s*["']@abadge\/db\/schema["']/.test(source);
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

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Glob } from "bun";

// §AB-0010 — the five org-scoped tenant tables must be reached through `scopedDb`,
// never imported directly into a server file. This CI enforcement bans runtime
// (non-type) imports of the schema barrel's tenant tables outside the permanent
// exempt set. `import type` statements are excluded because type-only imports
// cannot execute queries and are safe (e.g. serialize.ts uses them for typing).
const SERVER_DIR = path.resolve(import.meta.dir, "../..");
const TENANT_TABLES = ["items", "profiles", "agents", "permissions", "auditLogs"] as const;

// Files that are permanently exempt from the tenant-table import ban.
// These files either do not execute tenant-table queries themselves or have a
// documented reason why a direct import is correct (pre-auth, cascade, envelope).
const PERMANENT_EXEMPT = new Set<string>([
  // Write-only audit insert helper; org is always caller-stamped; never reads tenant rows.
  "audit.ts",
  // Pre-auth agent/session lookup; no org context exists at the time these queries run.
  "auth.ts",
  // Transaction cascade helpers; called by routers that own the tx boundary and orgId.
  "cascades.ts",
  // RBAC gate helpers; explicit org filter on member + agents lookups.
  "init.ts",
  // Crypto envelope helper; profile loaded by ID with caller-validated org ownership.
  "server-envelope.ts",
]);

function importsTenantTable(source: string): boolean {
  // Named import (runtime only — exclude `import type`): flag when a tenant
  // table is among the bindings.
  for (const m of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@abadge\/db\/schema["']/g)) {
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
  test("no server file imports a tenant table directly outside the permanent exempt set", () => {
    const offenders = serverFilesImportingTenantTables().filter((f) => !PERMANENT_EXEMPT.has(f));
    expect(offenders).toEqual([]);
  });

  test("the permanent exempt set has no stale entries", () => {
    const importing = new Set(serverFilesImportingTenantTables());
    const stale = [...PERMANENT_EXEMPT].filter((f) => !importing.has(f)).sort();
    expect(stale).toEqual([]);
  });
});

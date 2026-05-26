#!/usr/bin/env bun
/**
 * §AB-0024 — audit tamper-detection via sink divergence.
 *
 * Compares the DB `audit_logs` table against the second sink (the
 * `audit_mirror` lines emitted by mirrorAuditRow, shipped off-box by Workers
 * Logs → Logpush). A DB-side deletion shows up as a content-identity that is
 * present in the immutable sink export but missing from the table.
 *
 * This is the tooling for AB-0024 criterion 2 (the staging rehearsal: delete a
 * row in staging, run this, expect it flagged). It is read-only.
 *
 *   DATABASE_URL=... bun scripts/audit-divergence-check.ts --sink <logpush-export.jsonl>
 *
 * The sink export is newline-delimited JSON; only objects with `audit_mirror`
 * set are considered. Exits 1 if the sink contains audit events absent from the
 * DB (the tamper signal), 0 otherwise.
 */
import { readFileSync } from "node:fs";
import process from "node:process";
import { auditLogs, createDb } from "@abadge/db";

interface AuditIdentity {
  organizationId: string | null;
  userId: string | null;
  agentId: string | null;
  itemId: string | null;
  profileId: string | null;
  eventType: string | null;
  result: string | null;
  deliveryMode: string | null;
  field: string | null;
}

// Content-identity key. Excludes the DB-generated id + timestamps (which the
// sink can't reproduce exactly); the multiset of these keys is what diverges
// when a row is deleted from one sink but not the other.
function identityKey(row: AuditIdentity): string {
  return [
    row.organizationId,
    row.userId,
    row.agentId,
    row.itemId,
    row.profileId,
    row.eventType,
    row.result,
    row.deliveryMode,
    row.field,
  ]
    .map((value) => value ?? "")
    .join("|");
}

function multiset(keys: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const databaseUrl = process.env.DATABASE_URL;
const sinkPath = getArg("--sink");
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}
if (!sinkPath) {
  console.error("--sink <logpush-export.jsonl> is required.");
  process.exit(1);
}

const db = createDb(databaseUrl);

const dbRows = await db
  .select({
    organizationId: auditLogs.organizationId,
    userId: auditLogs.userId,
    agentId: auditLogs.agentId,
    itemId: auditLogs.itemId,
    profileId: auditLogs.profileId,
    eventType: auditLogs.eventType,
    result: auditLogs.result,
    deliveryMode: auditLogs.deliveryMode,
    field: auditLogs.field,
  })
  .from(auditLogs);
const dbCounts = multiset(dbRows.map(identityKey));

const sinkKeys: string[] = [];
for (const line of readFileSync(sinkPath, "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  const parsed = JSON.parse(trimmed) as Partial<AuditIdentity> & { audit_mirror?: unknown };
  if (!parsed.audit_mirror) continue;
  sinkKeys.push(identityKey(parsed as AuditIdentity));
}
const sinkCounts = multiset(sinkKeys);

// Events the sink recorded but the DB no longer has → potential tampering.
let missingFromDb = 0;
for (const [key, sinkCount] of sinkCounts) {
  const deficit = sinkCount - (dbCounts.get(key) ?? 0);
  if (deficit > 0) {
    missingFromDb += deficit;
    console.error(
      `DIVERGENCE: ${deficit} audit event(s) in the sink but missing from the DB: ${key}`,
    );
  }
}

if (missingFromDb > 0) {
  console.error(
    `\n✗ ${missingFromDb} audit event(s) present in the sink are absent from the DB — possible tampering.`,
  );
  process.exit(1);
}

console.log(
  `✓ No divergence: every sink audit event is present in the DB (${dbRows.length} DB rows, ${sinkKeys.length} sink events).`,
);

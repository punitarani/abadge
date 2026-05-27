#!/usr/bin/env bun
/**
 * Audit tamper-detection via sink divergence.
 *
 * Compares the DB `audit_logs` table against the second sink (the `audit_mirror`
 * lines emitted by mirrorAuditRow, shipped off-box to an append-only store). A
 * DB-side deletion shows up as a content-identity present in the immutable sink
 * export but missing from the table. Read-only.
 *
 *   DATABASE_URL=... bun scripts/audit-divergence-check.ts --sink <logpush-export.jsonl>
 *
 * The sink export is newline-delimited JSON; only objects with `audit_mirror`
 * set are considered. Exits 1 if the sink contains audit events absent from the
 * DB (the tamper signal), 0 otherwise. The comparison logic lives in
 * ./audit-divergence (kept DB-free so it is unit-testable).
 */
import { readFileSync } from "node:fs";
import process from "node:process";
import { auditLogs, createDb } from "@abadge/db";
import { findDivergences, identityKey, parseSinkKeys } from "./audit-divergence";

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

const sinkKeys = parseSinkKeys(readFileSync(sinkPath, "utf8"));
const divergences = findDivergences(dbRows.map(identityKey), sinkKeys);

let missingFromDb = 0;
for (const { key, deficit } of divergences) {
  missingFromDb += deficit;
  console.error(
    `DIVERGENCE: ${deficit} audit event(s) in the sink but missing from the DB: ${key}`,
  );
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

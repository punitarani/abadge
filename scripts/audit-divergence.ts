// Pure comparison logic for the audit-divergence check
// (scripts/audit-divergence-check.ts). Kept free of I/O and DB imports so it is
// unit-testable without a database.

export interface AuditIdentity {
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
// when a row is deleted from one sink but not the other. JSON-encoded so a field
// value containing a separator can't collide with a different row, and so null
// stays distinct from the empty string.
export function identityKey(row: AuditIdentity): string {
  return JSON.stringify([
    row.organizationId,
    row.userId,
    row.agentId,
    row.itemId,
    row.profileId,
    row.eventType,
    row.result,
    row.deliveryMode,
    row.field,
  ]);
}

function multiset(keys: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

// Parse a newline-delimited sink export into content-identity keys, keeping only
// `audit_mirror` objects. A malformed line is warned about and skipped rather
// than aborting the scan — an uncaught parse error would silently suppress the
// tamper signal for the whole file.
export function parseSinkKeys(content: string): string[] {
  const keys: string[] = [];
  for (const [index, line] of content.split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: Partial<AuditIdentity> & { audit_mirror?: unknown };
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      console.error(`WARN: skipping malformed JSON on line ${index + 1} of the sink export.`);
      continue;
    }
    if (!parsed.audit_mirror) continue;
    keys.push(identityKey(parsed as AuditIdentity));
  }
  return keys;
}

export interface Divergence {
  key: string;
  deficit: number;
}

// Events the sink recorded but the DB no longer has → potential tampering. Only
// sink⊄DB is reported; DB rows with no sink entry are benign (best-effort mirror).
export function findDivergences(dbKeys: string[], sinkKeys: string[]): Divergence[] {
  const dbCounts = multiset(dbKeys);
  const sinkCounts = multiset(sinkKeys);
  const divergences: Divergence[] = [];
  for (const [key, sinkCount] of sinkCounts) {
    const deficit = sinkCount - (dbCounts.get(key) ?? 0);
    if (deficit > 0) divergences.push({ key, deficit });
  }
  return divergences;
}

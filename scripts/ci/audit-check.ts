#!/usr/bin/env bun
/**
 * Dependency-audit gate (§AB-0104).
 *
 * Runs `bun audit --audit-level=high` with the advisories listed in
 * `.audit-allowlist.toml` suppressed, and exits non-zero on any finding that is
 * NOT allowlisted — so a newly introduced high/critical advisory fails CI.
 *
 * It also fails if any allowlist entry has passed its `expires` date, which
 * forces periodic re-triage instead of letting a suppression become permanent.
 */
import process from "node:process";
import allowlist from "../../.audit-allowlist.toml";

interface IgnoreEntry {
  id: string;
  package: string;
  reason: string;
  expires: string;
}

const entries: IgnoreEntry[] = (allowlist as { ignore?: IgnoreEntry[] }).ignore ?? [];

// 1. Reject expired suppressions — a suppression must never silently persist.
const now = Date.now();
const expired = entries.filter((entry) => {
  const at = Date.parse(entry.expires);
  if (Number.isNaN(at)) {
    throw new Error(`Invalid 'expires' for ${entry.id} in .audit-allowlist.toml: ${entry.expires}`);
  }
  return at < now;
});
if (expired.length > 0) {
  console.error("✗ Expired audit-allowlist entries — re-triage and update .audit-allowlist.toml:");
  for (const entry of expired) {
    console.error(`    ${entry.id} (${entry.package}) expired ${entry.expires}`);
  }
  process.exit(1);
}

// 2. Run the audit with allowlisted advisories suppressed.
const ignoreArgs = entries.map((entry) => `--ignore=${entry.id}`);
const result = Bun.spawnSync(["bun", "audit", "--audit-level=high", ...ignoreArgs], {
  stdout: "inherit",
  stderr: "inherit",
});

if (entries.length > 0) {
  console.error(
    `\n${entries.length} advisory suppression(s) active (see .audit-allowlist.toml); a new high/critical advisory still fails this gate.`,
  );
}

process.exit(result.exitCode ?? 1);

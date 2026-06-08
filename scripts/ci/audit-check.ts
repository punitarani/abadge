#!/usr/bin/env bun
/**
 * Dependency-audit gate (§AB-0104).
 *
 * Parses `bun audit --json` and fails on any high/critical advisory that is not
 * listed in `audit-allowlist.toml`, so a newly introduced advisory blocks CI.
 * It also fails if any allowlist entry has passed its `expires` date, forcing
 * periodic re-triage instead of letting a suppression become permanent.
 *
 * Severity filtering and suppression are done in-process against the JSON
 * report rather than via `bun audit`'s `--audit-level` / `--ignore` flags: those
 * flags' availability and accepted ID format (CVE vs GHSA) vary across bun
 * releases, whereas `--json` and the advisory schema are stable.
 */
import process from "node:process";
import allowlist from "../../audit-allowlist.toml";

interface IgnoreEntry {
  id: string;
  package: string;
  reason: string;
  expires: string;
}

interface Advisory {
  url: string;
  title: string;
  severity: string;
}

const BLOCKING_SEVERITIES = new Set(["high", "critical"]);

const entries: IgnoreEntry[] = (allowlist as { ignore?: IgnoreEntry[] }).ignore ?? [];

// 1. Reject expired suppressions — a suppression must never silently persist.
const now = Date.now();
const expired = entries.filter((entry) => {
  const at = Date.parse(entry.expires);
  if (Number.isNaN(at)) {
    throw new Error(`Invalid 'expires' for ${entry.id} in audit-allowlist.toml: ${entry.expires}`);
  }
  return at < now;
});
if (expired.length > 0) {
  console.error("✗ Expired audit-allowlist entries — re-triage and update audit-allowlist.toml:");
  for (const entry of expired) {
    console.error(`    ${entry.id} (${entry.package}) expired ${entry.expires}`);
  }
  process.exit(1);
}

const allowlisted = new Set(entries.map((entry) => entry.id));

// 2. Run the audit and read its JSON report. `bun audit` exits non-zero when it
//    finds any advisory (regardless of severity); we gate on severity ourselves.
const audit = Bun.spawnSync(["bun", "audit", "--json"], { stdout: "pipe", stderr: "inherit" });
const stdout = audit.stdout.toString().trim();

let report: Record<string, Advisory[]> = {};
if (stdout) {
  try {
    report = JSON.parse(stdout) as Record<string, Advisory[]>;
  } catch {
    console.error("✗ Could not parse `bun audit --json` output — failing closed.");
    process.exit(1);
  }
} else if (audit.exitCode !== 0) {
  // No report plus a non-success exit means the audit itself failed (e.g. a
  // network error reaching the advisory DB). Fail closed rather than vouch for
  // a tree we never actually scanned.
  console.error("✗ `bun audit` produced no report and exited non-zero — failing closed.");
  process.exit(1);
}

// The advisory id is the trailing GHSA segment of its GitHub advisory URL.
const advisoryId = (url: string): string => url.split("/").pop() ?? url;

const blocking = Object.entries(report).flatMap(([pkg, advisories]) =>
  advisories
    .filter((adv) => BLOCKING_SEVERITIES.has(adv.severity) && !allowlisted.has(advisoryId(adv.url)))
    .map((adv) => ({ pkg, id: advisoryId(adv.url), title: adv.title, severity: adv.severity })),
);

if (blocking.length > 0) {
  console.error(`✗ ${blocking.length} non-allowlisted high/critical advisory(ies):`);
  for (const adv of blocking) {
    console.error(`    ${adv.severity.toUpperCase()} ${adv.pkg} ${adv.id} — ${adv.title}`);
  }
  console.error(
    "\nUpgrade the dependency, or add a justified, expiring entry to audit-allowlist.toml.",
  );
  process.exit(1);
}

console.log(
  `✓ No non-allowlisted high/critical advisories (${entries.length} suppression(s) configured).`,
);

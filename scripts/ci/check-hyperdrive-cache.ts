#!/usr/bin/env bun
/**
 * Pre-deploy gate (§AB-0052).
 *
 * Verifies that the Cloudflare Hyperdrive resource backing the abadge API has
 * query caching disabled. Hyperdrive caching is a per-resource setting on
 * Cloudflare's side; wrangler ignores a "caching" key in wrangler.jsonc. If
 * caching were left enabled, authz reads (permission lookups, agent revocation
 * state, session validity, item soft-delete) would be served stale for up to
 * ~60 s after a revocation, opening a stale-authz window.
 *
 * Exits 0 on success or when CF credentials are absent (PR checks don't carry
 * them). Exits non-zero when caching is found to be enabled or the check cannot
 * be completed for any other reason.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const WRANGLER_JSONC = resolve(import.meta.dir, "../../apps/api/wrangler.jsonc");

function extractHyperdriveId(source: string): string {
  const match = /hyperdrive[\s\S]*?"id"\s*:\s*"([^"]+)"/.exec(source);
  if (!match) {
    console.error("✗ Could not extract Hyperdrive binding id from wrangler.jsonc");
    process.exit(1);
  }
  return match[1];
}

interface HyperdriveResponse {
  id: string;
  name?: string;
  caching?: {
    disabled?: boolean;
  };
}

const cfToken = process.env.CLOUDFLARE_API_TOKEN ?? process.env.CF_API_TOKEN ?? "";
if (!cfToken) {
  console.warn(
    "⚠ CLOUDFLARE_API_TOKEN / CF_API_TOKEN not set — skipping Hyperdrive cache check (deploy job only)",
  );
  process.exit(0);
}

const source = readFileSync(WRANGLER_JSONC, "utf-8");
const id = extractHyperdriveId(source);

const result = Bun.spawnSync(["wrangler", "hyperdrive", "get", id, "--json"], {
  stdout: "pipe",
  stderr: "pipe",
  env: { ...process.env, CLOUDFLARE_API_TOKEN: cfToken },
});

if (result.exitCode !== 0) {
  const stderr = result.stderr.toString().trim();
  if (/not found|command not found|ENOENT/.test(stderr) || result.exitCode === 127) {
    console.warn("⚠ wrangler binary not found or not in PATH — skipping Hyperdrive cache check");
    process.exit(0);
  }
  console.error("✗ `wrangler hyperdrive get` failed:");
  console.error(stderr || result.stdout.toString().trim());
  process.exit(1);
}

const raw = result.stdout.toString().trim();
let config: HyperdriveResponse;
try {
  config = JSON.parse(raw) as HyperdriveResponse;
} catch {
  console.error("✗ Could not parse `wrangler hyperdrive get --json` output — failing closed.");
  console.error(raw.slice(0, 500));
  process.exit(1);
}

if (config.caching?.disabled !== true) {
  console.error(
    `✗ Hyperdrive ${id} has caching enabled (caching.disabled = ${config.caching?.disabled ?? "undefined"})`,
  );
  console.error("  Run: wrangler hyperdrive update <id> --caching-disabled true");
  console.error("  See: apps/api/wrangler.jsonc §AB-0052 comment for context.");
  process.exit(1);
}

console.log(`✓ Hyperdrive ${id} has caching disabled — safe to deploy.`);

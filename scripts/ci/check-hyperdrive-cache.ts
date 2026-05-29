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
 * This runs ONLY in the deploy-api job (push to main), immediately before
 * `wrangler deploy`. It therefore fails closed on a missing token or missing
 * wrangler binary: in the deploy context both are required, so treating their
 * absence as a silent "skip" would be false assurance for a security gate.
 *
 * LIMITATION: this is a deploy-time check against the live resource. It cannot
 * catch caching being re-enabled on the Cloudflare resource AFTER a deploy
 * (TOCTOU drift) — re-assert via infra provisioning / a scheduled re-check. See
 * docs/decisions/002-hyperdrive-authz-cache-disabled.md.
 */
import { resolve } from "node:path";
import process from "node:process";

const WRANGLER_JSONC = resolve(import.meta.dir, "../../apps/api/wrangler.jsonc");

export interface HyperdriveConfigResponse {
  id: string;
  name?: string;
  caching?: {
    disabled?: boolean;
  };
}

/**
 * Read the first Hyperdrive binding's id from a parsed wrangler config. Pure so
 * it can be unit-tested without the filesystem; the binding shape is
 * `hyperdrive: [{ binding, id, ... }]`.
 */
export function hyperdriveIdFromWranglerConfig(config: unknown): string {
  const bindings = (config as { hyperdrive?: ReadonlyArray<{ id?: string }> }).hyperdrive;
  const id = bindings?.[0]?.id;
  if (!id) {
    throw new Error("Could not find hyperdrive[0].id in wrangler.jsonc");
  }
  return id;
}

/**
 * Decide whether a Hyperdrive config is safe to deploy. Fails closed: only an
 * explicit `caching.disabled === true` passes; `false` and absent both fail.
 */
export function evaluateCaching(config: HyperdriveConfigResponse): {
  ok: boolean;
  message: string;
} {
  if (config.caching?.disabled !== true) {
    return {
      ok: false,
      message: `Hyperdrive ${config.id} has caching enabled (caching.disabled = ${config.caching?.disabled ?? "undefined"})`,
    };
  }
  return { ok: true, message: `Hyperdrive ${config.id} has caching disabled — safe to deploy.` };
}

/**
 * Build the wrangler argv. NOTE: `wrangler hyperdrive get <id>` prints bare JSON
 * unconditionally — there is no `--json` flag (passing one makes wrangler exit
 * non-zero with "Unknown argument"). Kept pure so a test can assert the argv.
 */
export function wranglerGetArgs(id: string): string[] {
  return ["wrangler", "hyperdrive", "get", id];
}

async function main(): Promise<void> {
  const cfToken = process.env.CLOUDFLARE_API_TOKEN ?? process.env.CF_API_TOKEN ?? "";
  if (!cfToken) {
    console.error(
      "✗ CLOUDFLARE_API_TOKEN not set — cannot verify Hyperdrive caching. This gate runs in the deploy job, where the token is required; a missing token is a misconfiguration, not a skip.",
    );
    process.exit(1);
  }

  // Bun parses JSONC (comments) natively on import; Bun.file().json() does not.
  const wranglerConfig = (await import(WRANGLER_JSONC)).default;
  const id = hyperdriveIdFromWranglerConfig(wranglerConfig);

  // The Hyperdrive get endpoint is account-scoped; forward the account id when
  // present so a multi-account token can resolve the resource.
  const env: Record<string, string> = { ...process.env, CLOUDFLARE_API_TOKEN: cfToken };
  if (process.env.CLOUDFLARE_ACCOUNT_ID) {
    env.CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
  }

  // `wrangler` is an apps/api devDependency, not a global. This gate is invoked
  // directly (`bun .../check-hyperdrive-cache.ts`), NOT via a package script, so
  // node_modules/.bin is not on PATH and a bare `wrangler` spawn fails with
  // "Executable not found in $PATH" (the regression that has blocked deploy-api
  // since this gate was added). `bunx` resolves the locally-installed binary —
  // present after `bun install`, so it never hits the network — while keeping
  // wranglerGetArgs a pure, unit-testable argv.
  const result = Bun.spawnSync(["bunx", ...wranglerGetArgs(id)], {
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  if (result.exitCode !== 0) {
    // wrangler is a hard dependency of the very next deploy step, so its absence
    // (or any other failure) in the deploy job is fatal, never a silent skip.
    console.error("✗ `wrangler hyperdrive get` failed:");
    console.error(result.stderr.toString().trim() || result.stdout.toString().trim());
    process.exit(1);
  }

  const raw = result.stdout.toString().trim();
  let hyperdriveConfig: HyperdriveConfigResponse;
  try {
    hyperdriveConfig = JSON.parse(raw) as HyperdriveConfigResponse;
  } catch {
    console.error("✗ Could not parse `wrangler hyperdrive get` output — failing closed.");
    console.error(raw.slice(0, 500));
    process.exit(1);
  }

  const verdict = evaluateCaching(hyperdriveConfig);
  if (!verdict.ok) {
    console.error(`✗ ${verdict.message}`);
    console.error(`  Run: wrangler hyperdrive update ${id} --caching-disabled true`);
    console.error("  See: docs/decisions/002-hyperdrive-authz-cache-disabled.md");
    process.exit(1);
  }

  console.log(`✓ ${verdict.message}`);
}

if (import.meta.main) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

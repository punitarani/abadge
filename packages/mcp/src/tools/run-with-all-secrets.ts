import {
  ENV_VAR_NAME_PATTERN,
  labelToEnvKey,
  listStringFields,
  RESERVED_ENV_KEYS,
} from "@abadge/core";
import { z } from "zod";
import { getApiClient } from "../api-client.js";
import type { McpConfig } from "../config.js";
import { daemonDecrypt } from "../daemon-client.js";
import { buildChildEnv, countLines, MAX_OUTPUT_BYTES, runCommand } from "./run-with-secret.js";

export const toolName = "run_with_all_secrets";

export const toolDescription =
  "Run a command with EVERY env-var-shaped item in the named profile injected as a separate environment variable. Profile is the trust boundary: items in other profiles are NEVER injected, even if the agent has grants on them. Each item's label is normalized to a POSIX env-var name (e.g. 'openai-api-key' -> OPENAI_API_KEY). Only items with exactly one string field participate; multi-field items (logins, certs) are silently skipped — use run_with_secret with --field for those. Returns only the exit code, duration, output-line count, and a truncation flag. Subprocess stdout/stderr text is NEVER returned to the model. Hard-rejects on env-var-name collisions (two items normalizing to the same name) and on labels that normalize to reserved env vars (PATH, LD_PRELOAD, NODE_OPTIONS, …).";

export const toolInputSchema = z.object({
  profileId: z
    .string()
    .describe(
      "ID of the profile to bulk-mount from. Trust boundary — items in other profiles are NEVER returned.",
    ),
  command: z.string().describe("Command to run"),
  args: z.array(z.string()).optional().describe("Command arguments"),
  purpose: z.string().optional().describe("Why these credentials are needed"),
});

/**
 * §RED1-aligned per-item secret-size guard. Mirrors run_with_secret's
 * MAX_OUTPUT_BYTES bound: the in-process redaction property only holds when
 * each individual injected secret fits in the per-stream capture window. A
 * single oversized secret would defeat the bound for the whole call, so we
 * reject the entire call rather than silently dropping the offender.
 */
function assertSecretFits(envKey: string, value: string): void {
  const byteLength = Buffer.byteLength(value, "utf8");
  if (byteLength > MAX_OUTPUT_BYTES) {
    throw new Error(
      `Secret for env var '${envKey}' is ${byteLength} bytes but run_with_all_secrets only accepts secrets ≤ ${MAX_OUTPUT_BYTES} bytes per item. ` +
        `Use mount_secret (filesystem delivery) for that item, then run_with_all_secrets for the rest.`,
    );
  }
}

interface ResolvedItem {
  envKey: string;
  value: string;
  // Used in collision-error messages so the LLM can attribute the failure
  // to a specific item rather than guessing.
  itemId: string;
  label: string;
}

async function resolveOne(item: {
  storageMode: "zero_knowledge" | "server_managed";
  itemId: string;
  label: string;
  encryptedItemKey?: string;
  ciphertext?: string;
  profileId?: string;
  contentVersion?: number;
  payload?: unknown;
}): Promise<ResolvedItem | null> {
  let payload: unknown;
  if (item.storageMode === "zero_knowledge") {
    if (
      !item.encryptedItemKey ||
      !item.ciphertext ||
      !item.profileId ||
      typeof item.contentVersion !== "number"
    ) {
      throw new Error(
        `ZK item ${item.itemId} missing encryption envelope or AAD meta — cannot decrypt.`,
      );
    }
    const decrypted = await daemonDecrypt(item.encryptedItemKey, item.ciphertext, {
      profileId: item.profileId,
      itemId: item.itemId,
      contentVersion: item.contentVersion,
    });
    payload = decrypted.payload;
  } else {
    payload = item.payload;
  }

  // Structural filter: single string field only. Multi-field items are
  // silently skipped — same rule as the daemon's exec.envBulk so MCP and
  // CLI behaviors match.
  // biome-ignore lint/suspicious/noExplicitAny: payload validated at boundaries
  const stringFields = listStringFields(payload as any);
  if (stringFields.length !== 1) return null;

  // biome-ignore lint/suspicious/noExplicitAny: same — caller-validated shape
  const fields = (payload as any)?.fields as Record<string, unknown> | undefined;
  const fieldName = stringFields[0] as string;
  const value = fields?.[fieldName];
  if (typeof value !== "string") return null;

  const envKey = labelToEnvKey(item.label);
  if (envKey.length === 0) {
    throw new Error(
      `Item label '${item.label}' (id=${item.itemId}) cannot be normalized into a valid env var name.`,
    );
  }
  if (RESERVED_ENV_KEYS.has(envKey)) {
    throw new Error(
      `Item label '${item.label}' (id=${item.itemId}) normalizes to reserved env var '${envKey}'. Rename the item or exclude it.`,
    );
  }
  if (!ENV_VAR_NAME_PATTERN.test(envKey)) {
    throw new Error(
      `Item label '${item.label}' (id=${item.itemId}) produces invalid env var name '${envKey}'.`,
    );
  }
  return { envKey, value, itemId: item.itemId, label: item.label };
}

export async function handler(
  input: z.infer<typeof toolInputSchema>,
  config: McpConfig,
): Promise<string> {
  const startMs = Date.now();
  const client = await getApiClient(config);

  const bulk = await client.access.use({ profileId: input.profileId }, { delivery: "env" });
  if (!("items" in bulk)) throw new Error("Expected profile-scoped access response");

  const envMap: Record<string, string> = {};
  // Track which item produced which env var so a collision error names both.
  const envSource: Record<string, { itemId: string; label: string }> = {};

  for (const mount of bulk.items) {
    const item = await client.access.redeemMount(mount.mountId);
    const resolved = await resolveOne(item);
    if (!resolved) continue;

    assertSecretFits(resolved.envKey, resolved.value);

    const existing = envSource[resolved.envKey];
    if (existing) {
      throw new Error(
        `Env var collision on '${resolved.envKey}': items ${existing.itemId} ('${existing.label}') and ${resolved.itemId} ('${resolved.label}'). Rename one of them.`,
      );
    }
    envMap[resolved.envKey] = resolved.value;
    envSource[resolved.envKey] = { itemId: resolved.itemId, label: resolved.label };
  }

  const childEnv = { ...buildChildEnv(), ...envMap };

  const { exitCode, stdout, stderr, stdoutTruncated, stderrTruncated } = await runCommand(
    input.command,
    input.args ?? [],
    childEnv,
  );

  // Same §RED1 contract as run_with_secret: subprocess output text is NEVER
  // forwarded to the model. The LLM sees only enough to know the command
  // ran (exit code, duration, line counts, truncation) but cannot extract
  // any secret value via stdout/stderr leakage.
  return JSON.stringify({
    exitCode,
    durationMs: Date.now() - startMs,
    outputLineCount: {
      stdout: countLines(stdout),
      stderr: countLines(stderr),
    },
    truncated: stdoutTruncated || stderrTruncated,
    // Useful operational signal — how many env vars actually got injected
    // after the structural filter and bulk-skip rules. Helps the model tell
    // "no items in profile" from "subprocess just had nothing to do."
    injectedCount: Object.keys(envMap).length,
  });
}

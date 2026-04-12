import { randomBytes } from "node:crypto";
import { mkdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { z } from "zod";
import { getApiClient } from "../api-client.js";
import type { McpConfig } from "../config.js";
import { resolveSecret } from "../resolve-secret.js";

export const toolName = "mount_secret";

export const toolDescription =
  "Mount a secret as a temp file with 0600 permissions. Returns an opaque mountId — the file path is never returned to the model. Clean up with release_mount(mountId) or wait for auto-cleanup after 5 minutes.";

export const toolInputSchema = z.object({
  itemId: z.string().describe("ID of the item to mount"),
  field: z.string().optional().describe("Named field to mount from the item payload"),
  filename: z.string().optional().describe("Custom filename (default: item ID)"),
  purpose: z.string().optional().describe("Why this credential is needed"),
});

/** Active mounts keyed by opaque mountId. */
export const activeMounts = new Map<
  string,
  { filePath: string; dir: string; timer: ReturnType<typeof setTimeout> }
>();

async function cleanupMount(filePath: string, dir: string): Promise<void> {
  await unlink(filePath).catch(() => {});
  await rmdir(dir).catch(() => {});
}

export function releaseMount(mountId: string): boolean {
  const entry = activeMounts.get(mountId);
  if (!entry) return false;
  clearTimeout(entry.timer);
  activeMounts.delete(mountId);
  void cleanupMount(entry.filePath, entry.dir);
  return true;
}

export async function handler(
  input: z.infer<typeof toolInputSchema>,
  config: McpConfig,
): Promise<string> {
  const client = await getApiClient(config);
  const secret = await resolveSecret(client, input.itemId, "file", input.field);

  const suffix = randomBytes(8).toString("hex");
  const dir = join(tmpdir(), `abadge-${suffix}`);
  await mkdir(dir, { mode: 0o700 });

  const sanitized = basename(input.filename ?? input.itemId);
  const filePath = join(dir, sanitized);
  if (!filePath.startsWith(`${dir}/`)) {
    throw new Error("Invalid filename");
  }

  await writeFile(filePath, secret, { mode: 0o600 });

  const mountId = randomBytes(16).toString("hex");
  const timer = setTimeout(
    () => {
      activeMounts.delete(mountId);
      void cleanupMount(filePath, dir);
    },
    5 * 60 * 1000,
  );

  activeMounts.set(mountId, { filePath, dir, timer });

  return JSON.stringify({ mountId, permissions: "0600", expiresIn: "5 minutes" });
}

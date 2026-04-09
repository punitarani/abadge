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
  "Mount a secret as a temporary file with restricted permissions (0600). Returns only the file path — never the secret content. Auto-cleans after 5 minutes, or call release_mount to clean up early.";

export const toolInputSchema = z.object({
  itemId: z.string().describe("ID of the item to mount"),
  filename: z.string().optional().describe("Custom filename (default: item ID)"),
  purpose: z.string().optional().describe("Why this credential is needed"),
});

/** Active mounts keyed by file path, storing dir and cleanup timer. */
export const activeMounts = new Map<
  string,
  { dir: string; timer: ReturnType<typeof setTimeout> }
>();

async function cleanupMount(filePath: string, dir: string): Promise<void> {
  await unlink(filePath).catch(() => {});
  await rmdir(dir).catch(() => {});
}

export function releaseMount(filePath: string): boolean {
  const entry = activeMounts.get(filePath);
  if (!entry) return false;
  clearTimeout(entry.timer);
  activeMounts.delete(filePath);
  void cleanupMount(filePath, entry.dir);
  return true;
}

export async function handler(
  input: z.infer<typeof toolInputSchema>,
  config: McpConfig,
): Promise<string> {
  const client = await getApiClient(config);
  const secret = await resolveSecret(client, input.itemId, "file");

  const suffix = randomBytes(8).toString("hex");
  const dir = join(tmpdir(), `abadge-${suffix}`);
  await mkdir(dir, { mode: 0o700 });

  const sanitized = basename(input.filename ?? input.itemId);
  const filePath = join(dir, sanitized);
  if (!filePath.startsWith(`${dir}/`)) {
    throw new Error("Invalid filename");
  }

  await writeFile(filePath, secret, { mode: 0o600 });

  const timer = setTimeout(
    () => {
      activeMounts.delete(filePath);
      void cleanupMount(filePath, dir);
    },
    5 * 60 * 1000,
  );

  activeMounts.set(filePath, { dir, timer });

  return JSON.stringify({
    path: filePath,
    permissions: "0600",
    message:
      "Secret mounted. File will be auto-cleaned after 5 minutes. Use release_mount to clean up early.",
  });
}

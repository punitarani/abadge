import { randomBytes } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MountResult } from "./types";

/**
 * Write a secret to a temporary file with restricted permissions.
 * Returns the file path and a cleanup function that deletes it.
 */
export async function mountSecret(params: {
  secretValue: string;
  targetPath?: string;
  mode?: number;
}): Promise<MountResult> {
  const { secretValue, mode } = params;
  const suffix = randomBytes(8).toString("hex");
  const filePath = params.targetPath ?? join(tmpdir(), `abadge-secret-${suffix}`);

  await writeFile(filePath, secretValue, { mode: mode ?? 0o600 });

  return {
    path: filePath,
    cleanup: () => {
      void unlink(filePath).catch(() => {});
    },
  };
}

/**
 * Delete a previously mounted secret file.
 */
export async function cleanupMount(path: string): Promise<void> {
  await unlink(path).catch(() => {});
}

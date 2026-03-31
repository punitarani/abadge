import { randomBytes } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AbadgeClient } from "./client";
import type { MountResult } from "./types";

export async function mountSecret(params: {
  client: AbadgeClient;
  secretName: string;
  targetPath?: string;
  deliveryMode?: string;
  purpose?: string;
}): Promise<MountResult> {
  const { client, secretName, purpose } = params;
  const deliveryMode = params.deliveryMode ?? "file_mount";

  const result = await client.accessSecret({
    credentialName: secretName,
    deliveryMode,
    purpose,
  });

  if (!result.value) {
    throw new Error(`No secret value returned for "${secretName}"`);
  }

  const suffix = randomBytes(8).toString("hex");
  const filePath = params.targetPath ?? join(tmpdir(), `abadge-secret-${suffix}`);

  await writeFile(filePath, result.value, { mode: 0o600 });

  return {
    path: filePath,
    cleanup: () => {
      void unlink(filePath).catch(() => {});
    },
  };
}

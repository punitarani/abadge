import { resolveFieldValue } from "@abadge/core";
import type { AbadgeClient } from "@abadge/sdk";
import { daemonDecrypt } from "./daemon-client.js";

function payloadToSecret(payload: unknown, field?: string): string {
  if (typeof payload === "string") {
    return payload;
  }

  if (payload && typeof payload === "object") {
    const record = payload as { fields?: Record<string, unknown> };
    if (record.fields && typeof record.fields === "object") {
      return resolveFieldValue(record, field);
    }
  }

  return JSON.stringify(payload);
}

export async function resolveSecret(
  client: AbadgeClient,
  itemId: string,
  mountType: "env" | "file",
  field?: string,
): Promise<string> {
  const result = await client.accessMount(itemId, mountType);

  if (result.storageMode === "zero_knowledge") {
    const decrypted = await daemonDecrypt(result.encryptedItemKey, result.ciphertext);
    return payloadToSecret(decrypted.payload, field);
  }

  return payloadToSecret(result.payload, field);
}

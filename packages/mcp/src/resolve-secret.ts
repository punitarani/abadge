import type { AbadgeClient } from "@abadge/sdk";
import { daemonDecrypt } from "./daemon-client.js";

function payloadToSecret(payload: unknown): string {
  if (typeof payload === "string") {
    return payload;
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const fields = record.fields;
    if (
      fields &&
      typeof fields === "object" &&
      typeof (fields as Record<string, unknown>).value === "string"
    ) {
      return (fields as Record<string, unknown>).value as string;
    }
  }

  return JSON.stringify(payload);
}

export async function resolveSecret(
  client: AbadgeClient,
  itemId: string,
  mountType: "env" | "file",
): Promise<string> {
  const result = await client.accessMount(itemId, mountType);

  if (result.storageMode === "zero_knowledge") {
    const decrypted = await daemonDecrypt(result.encryptedItemKey, result.ciphertext);
    return payloadToSecret(decrypted.payload);
  }

  return payloadToSecret(result.payload);
}

import { resolveFieldValue } from "@abadge/core";
import type { AbadgeAgentClient } from "@abadge/sdk";
import { daemonDecrypt } from "./daemon";

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

async function decryptMountedPayload(
  encryptedItemKey: string,
  ciphertext: string,
  field?: string,
): Promise<string> {
  const result = await daemonDecrypt(encryptedItemKey, ciphertext);
  return payloadToSecret(result.payload, field);
}

async function resolveMountedSecret(
  client: AbadgeAgentClient,
  itemId: string,
  mountType: "env" | "file",
  field?: string,
): Promise<string> {
  const mounted = await client.accessMount(itemId, mountType);
  if (mounted.storageMode === "zero_knowledge") {
    return decryptMountedPayload(mounted.encryptedItemKey, mounted.ciphertext, field);
  }

  return payloadToSecret(mounted.payload, field);
}

export async function resolveSecretValue(
  client: AbadgeAgentClient,
  itemId: string,
  mountType: "env" | "file",
  field?: string,
): Promise<string> {
  return resolveMountedSecret(client, itemId, mountType, field);
}

import { resolveFieldValue } from "@abadge/core";
import { AbadgeApiError } from "@abadge/sdk";
import type { ApiClient } from "./client";
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
  client: ApiClient,
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
  client: ApiClient,
  itemId: string,
  mountType: "env" | "file",
  field?: string,
): Promise<string> {
  try {
    const item = (await client.getItem(itemId)).item;
    if (item.storageMode === "zero_knowledge") {
      return decryptMountedPayload(item.encryptedItemKey, item.ciphertext, field);
    }

    return resolveMountedSecret(client, itemId, mountType, field);
  } catch (error) {
    if (!(error instanceof AbadgeApiError) || error.code !== "UNAUTHORIZED") {
      throw error;
    }

    return resolveMountedSecret(client, itemId, mountType, field);
  }
}

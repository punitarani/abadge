import { AbadgeApiError } from "@abadge/sdk";
import type { ApiClient } from "./client";
import { daemonDecrypt } from "./daemon";

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

async function decryptMountedPayload(
  encryptedItemKey: string,
  ciphertext: string,
): Promise<string> {
  const result = await daemonDecrypt(encryptedItemKey, ciphertext);
  return payloadToSecret(result.payload);
}

async function resolveMountedSecret(
  client: ApiClient,
  itemId: string,
  mountType: "env" | "file",
): Promise<string> {
  const mounted = await client.accessMount(itemId, mountType);
  if (mounted.storageMode === "zero_knowledge") {
    return decryptMountedPayload(mounted.encryptedItemKey, mounted.ciphertext);
  }

  return payloadToSecret(mounted.payload);
}

export async function resolveSecretValue(
  client: ApiClient,
  itemId: string,
  mountType: "env" | "file",
): Promise<string> {
  try {
    const item = (await client.getItem(itemId)).item;
    if (item.storageMode === "zero_knowledge") {
      return decryptMountedPayload(item.encryptedItemKey, item.ciphertext);
    }

    return resolveMountedSecret(client, itemId, mountType);
  } catch (error) {
    if (!(error instanceof AbadgeApiError) || error.code !== "UNAUTHORIZED") {
      throw error;
    }

    return resolveMountedSecret(client, itemId, mountType);
  }
}

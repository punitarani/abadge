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
  if (!result.ok || !result.data) {
    throw new Error(result.error ?? "Vault is locked or decryption failed");
  }

  return payloadToSecret((result.data as { payload: unknown }).payload);
}

export async function resolveSecretValue(
  client: ApiClient,
  itemId: string,
  mountType: "env" | "file",
): Promise<string> {
  try {
    const item = (await client.getItem(itemId)).item;
    if (item.storageMode !== "zero_knowledge") {
      throw new Error("Server-managed items require a principal token with a mount grant.");
    }

    return decryptMountedPayload(item.encryptedItemKey, item.ciphertext);
  } catch (error) {
    if (!(error instanceof AbadgeApiError) || error.code !== "UNAUTHORIZED") {
      throw error;
    }

    const mounted = await client.accessMount(itemId, mountType);
    if (mounted.storageMode === "zero_knowledge") {
      return decryptMountedPayload(mounted.encryptedItemKey, mounted.ciphertext);
    }

    return payloadToSecret(mounted.payload);
  }
}

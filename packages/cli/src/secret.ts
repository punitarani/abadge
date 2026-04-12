import { payloadToSecret } from "@abadge/core";
import type { AbadgeAgentClient } from "@abadge/sdk";
import { daemonDecrypt } from "./daemon";

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

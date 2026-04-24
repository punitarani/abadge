import { payloadToSecret } from "@abadge/core";
import type { AbadgeAgentClient } from "@abadge/sdk";
import { daemonDecrypt } from "./daemon";

async function decryptMountedPayload(
  encryptedItemKey: string,
  ciphertext: string,
  meta: { profileId: string; itemId: string; contentVersion: number },
  field?: string,
): Promise<string> {
  try {
    const result = await daemonDecrypt(encryptedItemKey, ciphertext, meta);
    return payloadToSecret(result.payload, field);
  } catch {
    throw new Error(
      "Zero-knowledge items require the local daemon for decryption.\n" +
        "hint: Start it with: abadge daemon start && abadge profile unlock\n" +
        "hint: Or use a server-managed profile for remote agent access.",
    );
  }
}

async function resolveMountedSecret(
  client: AbadgeAgentClient,
  itemId: string,
  mountType: "env" | "file",
  field?: string,
): Promise<string> {
  const mounted = await client.accessMount(itemId, mountType, field);
  if (mounted.storageMode === "zero_knowledge") {
    return decryptMountedPayload(
      mounted.encryptedItemKey,
      mounted.ciphertext,
      {
        profileId: mounted.profileId,
        itemId: mounted.itemId,
        contentVersion: mounted.contentVersion,
      },
      field,
    );
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

import { payloadToSecret } from "@abadge/core";
import type { AbadgeAgentClient } from "@abadge/sdk";
import { daemonDecrypt } from "./daemon-client.js";

export async function resolveSecret(
  client: AbadgeAgentClient,
  itemId: string,
  mountType: "env" | "file",
  field?: string,
  purpose?: string,
): Promise<string> {
  const useResult = await client.access.use({ itemId }, { delivery: mountType, field, purpose });
  if (!("mountId" in useResult)) throw new Error("Expected item-scoped access response");
  const result = await client.access.redeemMount(useResult.mountId);

  if (result.storageMode === "zero_knowledge") {
    try {
      const decrypted = await daemonDecrypt(result.encryptedItemKey, result.ciphertext, {
        profileId: result.profileId,
        itemId: result.itemId,
        contentVersion: result.contentVersion,
      });
      return payloadToSecret(decrypted.payload, field);
    } catch {
      throw new Error(
        "Zero-knowledge items require the local daemon for decryption.\n" +
          "hint: Start the daemon with: abadge daemon start && abadge profile unlock\n" +
          "hint: Or use a server-managed profile for MCP access.",
      );
    }
  }

  return payloadToSecret(result.payload, field);
}

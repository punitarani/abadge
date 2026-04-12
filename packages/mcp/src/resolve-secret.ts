import { payloadToSecret } from "@abadge/core";
import type { AbadgeAgentClient } from "@abadge/sdk";
import { daemonDecrypt } from "./daemon-client.js";

export async function resolveSecret(
  client: AbadgeAgentClient,
  itemId: string,
  mountType: "env" | "file",
  field?: string,
  _purpose?: string,
): Promise<string> {
  // TODO: forward _purpose to client.accessMount once the SDK accepts it
  const result = await client.accessMount(itemId, mountType, field);

  if (result.storageMode === "zero_knowledge") {
    try {
      const decrypted = await daemonDecrypt(result.encryptedItemKey, result.ciphertext);
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

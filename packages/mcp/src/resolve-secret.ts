import { payloadToSecret } from "@abadge/core";
import { daemonErrorKind } from "@abadge/daemon";
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
    } catch (err) {
      // An MCP agent cannot unlock a profile (the master password lives only with
      // the human operator), so address the operator and distinguish the cause
      // instead of always blaming a missing daemon.
      switch (daemonErrorKind(err)) {
        case "locked":
          throw new Error(
            "This zero-knowledge item can't be decrypted: the operator's profile is locked. Ask the operator to run `abadge profile unlock` on the machine running this MCP server, or migrate the secret to a server-managed profile for MCP access.",
          );
        case "unreachable":
          throw new Error(
            "This zero-knowledge item needs the local abadge daemon, which isn't running. Ask the operator to run `abadge daemon start` (and `abadge profile unlock`) on this machine, or use a server-managed profile for MCP access.",
          );
        case "auth":
          throw new Error(
            "This zero-knowledge item can't be decrypted: the local daemon has no operator session. Ask the operator to run `abadge login` (then `abadge profile unlock`) on the machine running this MCP server.",
          );
        default:
          throw new Error(
            `Could not decrypt this zero-knowledge item via the local daemon: ${err instanceof Error ? err.message : String(err)}. Check the field name, or ask the operator to restart \`abadge daemon\` and re-unlock the profile.`,
          );
      }
    }
  }

  return payloadToSecret(result.payload, field);
}

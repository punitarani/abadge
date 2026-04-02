import { z } from "zod";
import { getApiClient, getApiErrorMessage } from "../api-client.js";
import type { McpConfig } from "../config.js";
import { daemonCall } from "../daemon-client.js";

export const toolName = "request_access";

export const toolDescription =
  "Request access to an item. For ZK items, decryption happens locally via daemon. Returns access status — never returns raw secret values.";

export const toolInputSchema = z.object({
  itemId: z.string().describe("ID of the item to access"),
  capability: z
    .enum(["mount_env", "mount_file"])
    .describe("Desired delivery mode (mount_env or mount_file)"),
  purpose: z.string().optional().describe("Why access is needed"),
});

export async function handler(
  input: z.infer<typeof toolInputSchema>,
  config: McpConfig,
): Promise<string> {
  const client = getApiClient(config);

  try {
    const response = await client.access.mount.mutate({
      itemId: input.itemId,
      mountType: input.capability === "mount_file" ? "file" : "env",
    });

    if (response.storageMode === "zero_knowledge") {
      try {
        await daemonCall("item.decrypt", {
          encryptedItemKey: response.encryptedItemKey,
          ciphertext: response.ciphertext,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Daemon decryption failed";
        return JSON.stringify({ status: "error", error: message });
      }
    }

    return JSON.stringify({
      status: "allowed",
      itemId: input.itemId,
      capability: input.capability,
    });
  } catch (error) {
    return JSON.stringify({
      status: "denied",
      error: getApiErrorMessage(error, "Access denied"),
    });
  }
}

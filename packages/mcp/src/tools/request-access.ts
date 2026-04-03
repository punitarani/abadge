import { AbadgeApiError } from "@abadge/sdk";
import { z } from "zod";
import { getApiClient } from "../api-client.js";
import type { McpConfig } from "../config.js";
import { daemonDecrypt } from "../daemon-client.js";

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
    const response = await client.accessMount(
      input.itemId,
      input.capability === "mount_file" ? "file" : "env",
    );

    if (response.storageMode === "zero_knowledge") {
      try {
        await daemonDecrypt(response.encryptedItemKey, response.ciphertext);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Daemon decryption failed";
        return JSON.stringify({ status: "error", error: message });
      }
    }

    return JSON.stringify({
      status: "granted",
      itemId: input.itemId,
      capability: input.capability,
    });
  } catch (error) {
    const message = error instanceof AbadgeApiError ? error.message : "Access denied";
    return JSON.stringify({
      status: "denied",
      error: message,
    });
  }
}

import { z } from "zod";
import { apiPost } from "../api-client.js";
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

interface AccessResponse {
  granted: boolean;
  storageMode?: string;
  ciphertext?: string;
  iv?: string;
  error?: string;
}

export async function handler(
  input: z.infer<typeof toolInputSchema>,
  config: McpConfig,
): Promise<string> {
  const res = await apiPost<AccessResponse>(config, `/v1/access/${input.itemId}`, {
    capability: input.capability,
    purpose: input.purpose,
  });

  if (!res.ok) {
    return JSON.stringify({ error: res.data.error ?? "Access denied" });
  }

  if (res.status === 202) {
    return JSON.stringify({
      status: "pending_approval",
      message: "Access request pending approval.",
    });
  }

  if (!res.data.granted) {
    return JSON.stringify({ status: "denied", error: res.data.error ?? "Access not granted" });
  }

  // For ZK items, verify decryption works via daemon (but don't return the value)
  if (res.data.storageMode === "zk" && res.data.ciphertext) {
    try {
      await daemonCall("decrypt", {
        ciphertext: res.data.ciphertext,
        iv: res.data.iv,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Daemon decryption failed";
      return JSON.stringify({ status: "error", error: msg });
    }
  }

  // Never return raw secret values
  return JSON.stringify({
    status: "granted",
    itemId: input.itemId,
    capability: input.capability,
  });
}

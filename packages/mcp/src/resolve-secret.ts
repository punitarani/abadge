import { getApiClient, getApiErrorMessage } from "./api-client.js";
import type { McpConfig } from "./config.js";
import { daemonCall } from "./daemon-client.js";

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

export async function resolveSecret(
  config: McpConfig,
  itemId: string,
  capability: "mount_env" | "mount_file",
  _purpose: string,
): Promise<string> {
  const client = getApiClient(config);

  try {
    const result = await client.access.mount.mutate({
      itemId,
      mountType: capability === "mount_file" ? "file" : "env",
    });

    if (result.storageMode === "zero_knowledge") {
      const decrypted = await daemonCall<{ payload: unknown }>("item.decrypt", {
        encryptedItemKey: result.encryptedItemKey,
        ciphertext: result.ciphertext,
      });
      return payloadToSecret(decrypted.payload);
    }

    return payloadToSecret(result.payload);
  } catch (error) {
    throw new Error(getApiErrorMessage(error, "Access denied"));
  }
}

import { apiPost } from "./api-client.js";
import type { McpConfig } from "./config.js";
import { daemonCall } from "./daemon-client.js";

interface AccessResponse {
  granted: boolean;
  storageMode?: string;
  ciphertext?: string;
  iv?: string;
  value?: string;
  error?: string;
}

export async function resolveSecret(
  config: McpConfig,
  itemId: string,
  capability: "mount_env" | "mount_file",
  purpose: string,
): Promise<string> {
  const res = await apiPost<AccessResponse>(config, `/v1/access/${itemId}`, {
    capability,
    purpose,
  });

  if (!res.ok || !res.data.granted) {
    throw new Error(res.data.error ?? "Access denied");
  }

  // ZK items: daemon decrypts locally
  if (res.data.storageMode === "zk" && res.data.ciphertext) {
    const result = await daemonCall<{ plaintext: string }>("decrypt", {
      ciphertext: res.data.ciphertext,
      iv: res.data.iv,
    });
    return result.plaintext;
  }

  if (res.data.value) {
    return res.data.value;
  }

  throw new Error("No secret value available");
}

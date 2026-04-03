import { DaemonClient, type DecryptResult } from "@abadge/daemon";

export async function daemonDecrypt(
  encryptedItemKey: string,
  ciphertext: string,
): Promise<DecryptResult> {
  const client = new DaemonClient();
  return client.decrypt(encryptedItemKey, ciphertext);
}

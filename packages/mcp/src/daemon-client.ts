import { DaemonClient, type DecryptResult } from "@abadge/daemon";

/**
 * §W1S7-001 — meta binds the item into the XChaCha20-Poly1305 AAD. The
 * access router returns profileId / itemId / contentVersion on the
 * ZeroKnowledgeMountAccessResponseSchema so the MCP can pass them
 * through unchanged; tampering with them here would fail the AEAD tag
 * check on the daemon side.
 */
export async function daemonDecrypt(
  encryptedItemKey: string,
  ciphertext: string,
  meta: { profileId: string; itemId: string; contentVersion: number },
): Promise<DecryptResult> {
  const client = new DaemonClient();
  return client.decrypt(encryptedItemKey, ciphertext, meta);
}

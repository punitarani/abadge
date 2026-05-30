import { DaemonClient, type DecryptResult } from "@abadge/daemon";

/**
 * `meta` binds the item into the XChaCha20-Poly1305 AAD. The access router
 * returns profileId / itemId / contentVersion on the
 * ZeroKnowledgeMountAccessResponseSchema so the MCP can pass them through
 * unchanged; tampering with them here would fail the AEAD tag check on the
 * daemon side.
 */
export async function daemonDecrypt(
  encryptedItemKey: string,
  ciphertext: string,
  meta: { profileId: string; itemId: string; contentVersion: number },
): Promise<DecryptResult> {
  // TODO(B43): wire to shared pinning store so MCP agents catch same-UID squatter.
  // `new DaemonClient()` uses the string/undefined back-compat path: Ed25519
  // signature verification runs on every sensitive call, but the fingerprint is
  // not persisted across sessions. The back-compat path is still allowed without
  // `skipPersistentPinning` because it is the plain-undefined constructor path,
  // not an options bag with callbacks omitted.
  const client = new DaemonClient();
  return client.decrypt(encryptedItemKey, ciphertext, meta);
}

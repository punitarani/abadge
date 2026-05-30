import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { buildZkContentAad, buildZkDekWrapAad } from "../shared/aad";
import { fromBase64, randomBytes, toBase64 } from "../shared/encoding";
import type { EncryptedItem } from "../shared/types";

const NONCE_LEN = 24; // XChaCha20-Poly1305 nonce size

/**
 * Metadata that names the identity a ZK ciphertext is bound to via AAD.
 *
 * Binding the per-item DEK wrap and content cipher to `{profileId, itemId,
 * contentVersion}` closes the row-swap attack: without it, a DB-write adversary
 * that exchanges `(encryptedItemKey, ciphertext)` pairs between two items in the
 * same profile would see XChaCha20-Poly1305 decrypt succeed and return the wrong
 * plaintext under the wrong label. With the binding, the AEAD tag check ties the
 * ciphertext to its identity and a swap fails to authenticate.
 *
 * `contentVersion` defaults to `1` (the `items.content_version` column default)
 * on create. On rewrite, callers MUST pass the NEW version the row is about to
 * take (`currentContentVersion + 1`). Decrypt sites pass the stored version.
 */
export interface ZkItemMeta {
  profileId: string;
  itemId: string;
  contentVersion?: number;
}

/**
 * Encrypt an item payload using a fresh per-item DEK wrapped by the root key.
 *
 * 1. Generate a random 32-byte DEK
 * 2. Encrypt plaintext with the DEK (XChaCha20-Poly1305 + content AAD)
 * 3. Wrap the DEK with the root key (XChaCha20-Poly1305 + DEK-wrap AAD)
 * 4. Return both as base64url strings, each with its 24-byte nonce prepended
 *
 * AAD is mandatory: the matching `decryptItem` call MUST receive the same
 * `{profileId, itemId, contentVersion}`, or both AEAD tag checks fail and throw.
 */
export function encryptItem(
  plaintext: Uint8Array,
  rootKey: Uint8Array,
  meta: ZkItemMeta,
): EncryptedItem {
  const contentVersion = meta.contentVersion ?? 1;

  // Generate per-item DEK
  const dek = randomBytes(32);

  // Encrypt payload with DEK + content AAD
  const contentNonce = randomBytes(NONCE_LEN);
  const contentAad = buildZkContentAad({
    profileId: meta.profileId,
    itemId: meta.itemId,
    contentVersion,
  });
  const contentCipher = xchacha20poly1305(dek, contentNonce, contentAad);
  const contentCiphertext = contentCipher.encrypt(plaintext);
  const contentCombined = new Uint8Array(NONCE_LEN + contentCiphertext.length);
  contentCombined.set(contentNonce);
  contentCombined.set(contentCiphertext, NONCE_LEN);

  // Wrap DEK with root key + DEK-wrap AAD
  const keyNonce = randomBytes(NONCE_LEN);
  const dekAad = buildZkDekWrapAad({ profileId: meta.profileId, itemId: meta.itemId });
  const keyCipher = xchacha20poly1305(rootKey, keyNonce, dekAad);
  const wrappedDek = keyCipher.encrypt(dek);
  const keyCombined = new Uint8Array(NONCE_LEN + wrappedDek.length);
  keyCombined.set(keyNonce);
  keyCombined.set(wrappedDek, NONCE_LEN);

  // Zero DEK from memory (best-effort)
  dek.fill(0);

  return {
    encryptedItemKey: toBase64(keyCombined),
    ciphertext: toBase64(contentCombined),
  };
}

/**
 * Decrypt an item by unwrapping its DEK with the root key, then decrypting the payload.
 *
 * The `{profileId, itemId, contentVersion}` passed here must exactly match the
 * values used at encrypt time; otherwise both AEAD tag checks (DEK unwrap and
 * content decrypt) fail with an "invalid tag" error.
 */
export function decryptItem(
  item: EncryptedItem,
  rootKey: Uint8Array,
  meta: ZkItemMeta,
): Uint8Array {
  const contentVersion = meta.contentVersion ?? 1;

  // Unwrap DEK
  const keyCombined = fromBase64(item.encryptedItemKey);
  const keyNonce = keyCombined.slice(0, NONCE_LEN);
  const wrappedDek = keyCombined.slice(NONCE_LEN);
  const dekAad = buildZkDekWrapAad({ profileId: meta.profileId, itemId: meta.itemId });
  const keyCipher = xchacha20poly1305(rootKey, keyNonce, dekAad);
  const dek = keyCipher.decrypt(wrappedDek);

  // Decrypt payload
  const contentCombined = fromBase64(item.ciphertext);
  const contentNonce = contentCombined.slice(0, NONCE_LEN);
  const contentCiphertext = contentCombined.slice(NONCE_LEN);
  const contentAad = buildZkContentAad({
    profileId: meta.profileId,
    itemId: meta.itemId,
    contentVersion,
  });
  const contentCipher = xchacha20poly1305(dek, contentNonce, contentAad);
  const plaintext = contentCipher.decrypt(contentCiphertext);

  // Zero DEK (best-effort)
  dek.fill(0);

  return plaintext;
}

/**
 * Re-wrap an item's DEK with a new root key (for root-key rotation).
 * Does NOT re-encrypt the item content — only the DEK wrapper changes.
 *
 * The DEK-wrap AAD binds to (profile, item) so the same AAD is used for both
 * the old-root unwrap and the new-root wrap; no `contentVersion` is involved
 * because the content ciphertext is preserved verbatim.
 */
export function rekeyItem(
  encryptedItemKey: string,
  oldRootKey: Uint8Array,
  newRootKey: Uint8Array,
  meta: Omit<ZkItemMeta, "contentVersion">,
): string {
  // Unwrap DEK with old root key
  const dekAad = buildZkDekWrapAad({ profileId: meta.profileId, itemId: meta.itemId });
  const keyCombined = fromBase64(encryptedItemKey);
  const keyNonce = keyCombined.slice(0, NONCE_LEN);
  const wrappedDek = keyCombined.slice(NONCE_LEN);
  const oldCipher = xchacha20poly1305(oldRootKey, keyNonce, dekAad);
  const dek = oldCipher.decrypt(wrappedDek);

  // Re-wrap DEK with new root key (same DEK-wrap AAD — identity is unchanged)
  const newNonce = randomBytes(NONCE_LEN);
  const newCipher = xchacha20poly1305(newRootKey, newNonce, dekAad);
  const newWrappedDek = newCipher.encrypt(dek);
  const newCombined = new Uint8Array(NONCE_LEN + newWrappedDek.length);
  newCombined.set(newNonce);
  newCombined.set(newWrappedDek, NONCE_LEN);

  // Zero DEK
  dek.fill(0);

  return toBase64(newCombined);
}

/**
 * Serialize an item plaintext envelope to bytes for encryption.
 * Accepts any JSON-serializable object (typically ItemPayload).
 */
export function serializeItemPayload(payload: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

/**
 * Deserialize decrypted item bytes back to the plaintext envelope.
 * Caller should validate/cast the result to the expected type.
 */
export function deserializeItemPayload<T = unknown>(bytes: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(bytes));
}

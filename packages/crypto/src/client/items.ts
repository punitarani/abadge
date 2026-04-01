import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { fromBase64, randomBytes, toBase64 } from "../shared/encoding";
import type { EncryptedItem } from "../shared/types";

const NONCE_LEN = 24; // XChaCha20-Poly1305 nonce size

/**
 * Encrypt an item payload using a fresh per-item DEK wrapped by the root key.
 *
 * 1. Generate random 32-byte DEK
 * 2. Encrypt plaintext with DEK (XChaCha20-Poly1305)
 * 3. Wrap DEK with root key (XChaCha20-Poly1305)
 * 4. Return both as base64url strings (nonce prepended to each)
 */
export function encryptItem(plaintext: Uint8Array, rootKey: Uint8Array): EncryptedItem {
  // Generate per-item DEK
  const dek = randomBytes(32);

  // Encrypt payload with DEK
  const contentNonce = randomBytes(NONCE_LEN);
  const contentCipher = xchacha20poly1305(dek, contentNonce);
  const contentCiphertext = contentCipher.encrypt(plaintext);
  const contentCombined = new Uint8Array(NONCE_LEN + contentCiphertext.length);
  contentCombined.set(contentNonce);
  contentCombined.set(contentCiphertext, NONCE_LEN);

  // Wrap DEK with root key
  const keyNonce = randomBytes(NONCE_LEN);
  const keyCipher = xchacha20poly1305(rootKey, keyNonce);
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
 */
export function decryptItem(item: EncryptedItem, rootKey: Uint8Array): Uint8Array {
  // Unwrap DEK
  const keyCombined = fromBase64(item.encryptedItemKey);
  const keyNonce = keyCombined.slice(0, NONCE_LEN);
  const wrappedDek = keyCombined.slice(NONCE_LEN);
  const keyCipher = xchacha20poly1305(rootKey, keyNonce);
  const dek = keyCipher.decrypt(wrappedDek);

  // Decrypt payload
  const contentCombined = fromBase64(item.ciphertext);
  const contentNonce = contentCombined.slice(0, NONCE_LEN);
  const contentCiphertext = contentCombined.slice(NONCE_LEN);
  const contentCipher = xchacha20poly1305(dek, contentNonce);
  const plaintext = contentCipher.decrypt(contentCiphertext);

  // Zero DEK (best-effort)
  dek.fill(0);

  return plaintext;
}

/**
 * Re-wrap an item's DEK with a new root key (for root key rotation).
 * Does NOT re-encrypt the item content — only the DEK wrapper changes.
 */
export function rekeyItem(
  encryptedItemKey: string,
  oldRootKey: Uint8Array,
  newRootKey: Uint8Array,
): string {
  // Unwrap DEK with old root key
  const keyCombined = fromBase64(encryptedItemKey);
  const keyNonce = keyCombined.slice(0, NONCE_LEN);
  const wrappedDek = keyCombined.slice(NONCE_LEN);
  const oldCipher = xchacha20poly1305(oldRootKey, keyNonce);
  const dek = oldCipher.decrypt(wrappedDek);

  // Re-wrap DEK with new root key
  const newNonce = randomBytes(NONCE_LEN);
  const newCipher = xchacha20poly1305(newRootKey, newNonce);
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

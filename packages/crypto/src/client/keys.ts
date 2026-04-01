import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { randomBytes as nobleRandom } from "@noble/ciphers/webcrypto";
import {
  formatRecoveryKey,
  fromBase32,
  fromBase64,
  randomBytes,
  toBase32,
  toBase64,
} from "../shared/encoding.js";
import type { WrappedKey } from "../shared/types.js";

const NONCE_LEN = 24; // XChaCha20-Poly1305 nonce size

/** Generate a new 32-byte root key. */
export function generateRootKey(): Uint8Array {
  return randomBytes(32);
}

/**
 * Wrap (encrypt) a root key with a KEK using XChaCha20-Poly1305.
 * Returns base64url string: nonce (24 bytes) || ciphertext + tag.
 */
export function wrapRootKey(rootKey: Uint8Array, kek: Uint8Array): WrappedKey {
  const nonce = randomBytes(NONCE_LEN);
  const cipher = xchacha20poly1305(kek, nonce);
  const ciphertext = cipher.encrypt(rootKey);

  const combined = new Uint8Array(NONCE_LEN + ciphertext.length);
  combined.set(nonce);
  combined.set(ciphertext, NONCE_LEN);

  return { wrapped: toBase64(combined) };
}

/**
 * Unwrap (decrypt) a root key from a wrapped key using KEK.
 * Input is base64url string: nonce (24 bytes) || ciphertext + tag.
 */
export function unwrapRootKey(wrapped: WrappedKey, kek: Uint8Array): Uint8Array {
  const combined = fromBase64(wrapped.wrapped);
  const nonce = combined.slice(0, NONCE_LEN);
  const ciphertext = combined.slice(NONCE_LEN);

  const cipher = xchacha20poly1305(kek, nonce);
  return cipher.decrypt(ciphertext);
}

/**
 * Generate a recovery key and wrap the root key with it.
 * Returns the formatted recovery key (show once) and the wrapped root key.
 */
export function generateRecoveryKey(rootKey: Uint8Array): {
  recoveryKey: string;
  wrappedRootKey: WrappedKey;
} {
  const recoveryBytes = randomBytes(32);
  const wrappedRootKey = wrapRootKey(rootKey, recoveryBytes);
  const recoveryKey = formatRecoveryKey(toBase32(recoveryBytes));
  return { recoveryKey, wrappedRootKey };
}

/**
 * Recover a root key using a recovery key string (base32 with dashes).
 */
export function recoverRootKey(recoveryKey: string, wrappedRootKey: WrappedKey): Uint8Array {
  const recoveryBytes = fromBase32(recoveryKey);
  return unwrapRootKey(wrappedRootKey, recoveryBytes);
}

/**
 * Zero out sensitive key material from memory.
 * Best-effort defense in depth — not guaranteed by JS runtime.
 */
export function zeroKey(key: Uint8Array): void {
  key.fill(0);
}

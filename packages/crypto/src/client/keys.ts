import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { buildZkRootWrapAad, type ZkRootWrapAadMeta } from "../shared/aad";
import {
  formatRecoveryKey,
  fromBase32,
  fromBase64,
  randomBytes,
  toBase32,
  toBase64,
} from "../shared/encoding";
import type { WrappedKey } from "../shared/types";

const NONCE_LEN = 24; // XChaCha20-Poly1305 nonce size

/** Generate a new 32-byte root key. */
export function generateRootKey(): Uint8Array {
  return randomBytes(32);
}

/**
 * Wrap (encrypt) a root key with a KEK using XChaCha20-Poly1305.
 * Returns base64url string: nonce (24 bytes) || ciphertext + tag.
 *
 * AAD binds the wrap to `{profileId, keyVersion}` so a wrapped root key cannot
 * be substituted across profiles or replayed onto a rotated profile with a
 * different `keyVersion`. The same wrapper serves both the primary
 * password-derived wrap and the recovery-key wrap — the distinction lives in
 * the KEK, not the AAD.
 */
export function wrapRootKey(
  rootKey: Uint8Array,
  kek: Uint8Array,
  meta: ZkRootWrapAadMeta,
): WrappedKey {
  const aad = buildZkRootWrapAad(meta);
  const nonce = randomBytes(NONCE_LEN);
  const cipher = xchacha20poly1305(kek, nonce, aad);
  const ciphertext = cipher.encrypt(rootKey);

  const combined = new Uint8Array(NONCE_LEN + ciphertext.length);
  combined.set(nonce);
  combined.set(ciphertext, NONCE_LEN);

  return { wrapped: toBase64(combined) };
}

/**
 * Unwrap (decrypt) a root key from a wrapped key using KEK.
 * Input is base64url string: nonce (24 bytes) || ciphertext + tag.
 *
 * `meta` MUST match the values used at wrap time; otherwise the AEAD tag
 * verification fails and this throws.
 */
export function unwrapRootKey(
  wrapped: WrappedKey,
  kek: Uint8Array,
  meta: ZkRootWrapAadMeta,
): Uint8Array {
  const aad = buildZkRootWrapAad(meta);
  const combined = fromBase64(wrapped.wrapped);
  const nonce = combined.slice(0, NONCE_LEN);
  const ciphertext = combined.slice(NONCE_LEN);

  const cipher = xchacha20poly1305(kek, nonce, aad);
  return cipher.decrypt(ciphertext);
}

/**
 * Generate a recovery key and wrap the root key with it.
 * Returns the formatted recovery key (show once) and the wrapped root key.
 *
 * The recovery-wrap uses the same AAD schema as the primary wrap
 * (`buildZkRootWrapAad`), so recovery and primary wraps are symmetric —
 * both bind to `{profileId, keyVersion}`. Mutating either without the
 * other during rotation would leave the recovery wrap decryptable only
 * under the pre-rotation AAD.
 */
export function generateRecoveryKey(
  rootKey: Uint8Array,
  meta: ZkRootWrapAadMeta,
): {
  recoveryKey: string;
  wrappedRootKey: WrappedKey;
} {
  const recoveryBytes = randomBytes(32);
  const wrappedRootKey = wrapRootKey(rootKey, recoveryBytes, meta);
  const recoveryKey = formatRecoveryKey(toBase32(recoveryBytes));
  return { recoveryKey, wrappedRootKey };
}

/**
 * Recover a root key using a recovery key string (base32 with dashes).
 */
export function recoverRootKey(
  recoveryKey: string,
  wrappedRootKey: WrappedKey,
  meta: ZkRootWrapAadMeta,
): Uint8Array {
  const recoveryBytes = fromBase32(recoveryKey);
  return unwrapRootKey(wrappedRootKey, recoveryBytes, meta);
}

/**
 * Zero out sensitive key material from memory.
 * Best-effort defense in depth — not guaranteed by JS runtime.
 */
export function zeroKey(key: Uint8Array): void {
  key.fill(0);
}

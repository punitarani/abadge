import { buildServerAad, type ServerAadMeta } from "../shared/aad";
import { fromBase64, toBase64 } from "../shared/encoding";
import type { ServerEncryptedItem } from "../shared/types";

const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12;

/** Get a clean ArrayBuffer from a Uint8Array (handles offset/length correctly). */
function toArrayBuffer(arr: Uint8Array): ArrayBuffer {
  return arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength) as ArrayBuffer;
}

async function importKey(base64Key: string): Promise<CryptoKey> {
  const raw = fromBase64(base64Key);
  if (raw.byteLength !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256), got ${raw.byteLength} bytes`,
    );
  }
  return crypto.subtle.importKey("raw", toArrayBuffer(raw), { name: ALGORITHM }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Encrypt a payload using AES-256-GCM (server-side, for server_managed items).
 * Uses WebCrypto for Cloudflare Workers compatibility.
 *
 * When `aadMeta` is provided, the ciphertext is bound to the
 * `(orgId, profileId, itemId, keyVersion)` tuple via AES-GCM
 * `additionalData`. New writes MUST pass `aadMeta` and use
 * `keyVersion >= SERVER_AAD_MIN_VERSION`. Omitting `aadMeta` reproduces
 * the legacy v1 no-AAD ciphertext format and is only used for migration
 * and backward-compatible decrypts (see `serverDecrypt`).
 */
export async function serverEncrypt(
  plaintext: Uint8Array,
  base64Key: string,
  keyVersion: number,
  aadMeta?: ServerAadMeta,
): Promise<ServerEncryptedItem> {
  const key = await importKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const algorithm = aadMeta
    ? {
        name: ALGORITHM,
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(buildServerAad(aadMeta)),
      }
    : { name: ALGORITHM, iv: toArrayBuffer(iv) };

  const encrypted = await crypto.subtle.encrypt(algorithm, key, toArrayBuffer(plaintext));
  return {
    ciphertext: toBase64(new Uint8Array(encrypted)),
    iv: toBase64(iv),
    keyVersion,
  };
}

/**
 * Decrypt a server-managed item using AES-256-GCM.
 *
 * Pass `aadMeta` only for rows whose `serverKeyVersion >=
 * SERVER_AAD_MIN_VERSION` (v2+). Legacy v1 ciphertext was written
 * without AAD; attempting to decrypt it with AAD will fail tag
 * verification. Callers must branch on the stored `serverKeyVersion`.
 */
export async function serverDecrypt(
  item: ServerEncryptedItem,
  base64Key: string,
  aadMeta?: ServerAadMeta,
): Promise<Uint8Array> {
  const key = await importKey(base64Key);
  const ciphertext = fromBase64(item.ciphertext);
  const iv = fromBase64(item.iv);

  const algorithm = aadMeta
    ? {
        name: ALGORITHM,
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(buildServerAad(aadMeta)),
      }
    : { name: ALGORITHM, iv: toArrayBuffer(iv) };

  const decrypted = await crypto.subtle.decrypt(algorithm, key, toArrayBuffer(ciphertext));
  return new Uint8Array(decrypted);
}

// §AB-0030 — per-profile envelope. Each server_managed profile owns a 32-byte
// DEK, wrapped under the master ENCRYPTION_KEY. v3 item content is encrypted
// under the DEK (via serverEncrypt with the DEK as the key), so rotating the
// master key only rewraps DEKs — no content re-encryption. See ENVELOPE_SPEC.

const DEK_LENGTH = 32;

/** Generate a fresh 32-byte server-managed profile DEK. */
export function generateServerDek(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(DEK_LENGTH));
}

/**
 * Wrap a profile DEK under the master key (AES-256-GCM, no AAD — the DEK is
 * opaque key material). Returns self-contained base64 `iv (12) || ciphertext+tag`.
 */
export async function wrapServerDek(masterKeyBase64: string, dek: Uint8Array): Promise<string> {
  if (dek.byteLength !== DEK_LENGTH) {
    throw new Error(`server DEK must be ${DEK_LENGTH} bytes, got ${dek.byteLength}`);
  }
  const key = await importKey(masterKeyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: ALGORITHM, iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(dek),
    ),
  );
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(ciphertext, iv.byteLength);
  return toBase64(combined);
}

/** Unwrap a profile DEK wrapped by {@link wrapServerDek}. Returns the 32-byte DEK. */
export async function unwrapServerDek(
  masterKeyBase64: string,
  wrappedBase64: string,
): Promise<Uint8Array> {
  const key = await importKey(masterKeyBase64);
  const combined = fromBase64(wrappedBase64);
  const iv = combined.subarray(0, IV_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH);
  const dek = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: ALGORITHM, iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(ciphertext),
    ),
  );
  return dek;
}

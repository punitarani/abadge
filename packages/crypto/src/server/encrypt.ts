import {
  buildServerAad,
  buildServerDekWrapAad,
  type ServerAadMeta,
  type ServerDekWrapAadMeta,
} from "../shared/aad";
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

// Key commitment. AES-GCM is not key-committing: a single ciphertext can, in
// principle, be crafted to decrypt validly under two different keys
// (partitioning-oracle / key-confusion attack). At keyVersion >=
// COMMIT_MIN_VERSION, server-managed ciphertext prefixes a key-commitment tag —
// HMAC-SHA256(contentKey, fixed context) — to the AES-GCM output, binding the
// ciphertext to the exact content key. It is verified (constant-time) before
// decryption. The stored keyVersion selects the on-disk format, so versions
// below the threshold (which carry no commitment) decrypt unchanged.
const COMMIT_MIN_VERSION = 4;
const COMMITMENT_LENGTH = 32; // HMAC-SHA256 output
const COMMITMENT_CONTEXT = new TextEncoder().encode("abadge/server-envelope/key-commitment/v1");

async function keyCommitment(base64Key: string): Promise<Uint8Array> {
  const raw = fromBase64(base64Key);
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(raw),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", hmacKey, toArrayBuffer(COMMITMENT_CONTEXT)),
  );
}

/** Constant-time equality — no early-exit on first mismatch, so comparing the
 * key-commitment tag leaks no timing signal. */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

/**
 * Encrypt a payload using AES-256-GCM (server-side, for server_managed items).
 * Uses WebCrypto for Cloudflare Workers compatibility.
 *
 * When `aadMeta` is provided, the ciphertext is bound to the
 * `(orgId, profileId, itemId, keyVersion)` tuple via AES-GCM `additionalData`,
 * so a DB-write adversary cannot transplant ciphertext between items. New
 * writes pass `aadMeta` with `keyVersion >= SERVER_AAD_MIN_VERSION`. Omitting
 * `aadMeta` produces the no-AAD format, which only `serverDecrypt` of rows
 * written below that version relies on.
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

  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(algorithm, key, toArrayBuffer(plaintext)),
  );
  // At/above COMMIT_MIN_VERSION, prefix the key-commitment tag to the output.
  let body = encrypted;
  if (keyVersion >= COMMIT_MIN_VERSION) {
    const commitment = await keyCommitment(base64Key);
    body = new Uint8Array(commitment.byteLength + encrypted.byteLength);
    body.set(commitment, 0);
    body.set(encrypted, commitment.byteLength);
  }
  return { ciphertext: toBase64(body), iv: toBase64(iv), keyVersion };
}

/**
 * Decrypt a server-managed item using AES-256-GCM.
 *
 * Pass `aadMeta` only for rows whose `serverKeyVersion >=
 * SERVER_AAD_MIN_VERSION`. Older ciphertext was written without AAD;
 * decrypting it WITH AAD fails tag verification. Callers must branch on the
 * stored `serverKeyVersion`.
 */
export async function serverDecrypt(
  item: ServerEncryptedItem,
  base64Key: string,
  aadMeta?: ServerAadMeta,
): Promise<Uint8Array> {
  const key = await importKey(base64Key);
  let ciphertext = fromBase64(item.ciphertext);
  const iv = fromBase64(item.iv);

  // Versions at/above COMMIT_MIN_VERSION carry a key-commitment prefix; verify
  // it (constant-time) and strip it before decryption, rejecting a ciphertext
  // whose commitment does not match this key.
  if (item.keyVersion >= COMMIT_MIN_VERSION) {
    const stored = ciphertext.subarray(0, COMMITMENT_LENGTH);
    const expected = await keyCommitment(base64Key);
    if (!constantTimeEqual(stored, expected)) {
      throw new Error("server-managed key-commitment mismatch");
    }
    ciphertext = ciphertext.subarray(COMMITMENT_LENGTH);
  }

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

// Per-profile envelope: each server_managed profile owns a 32-byte DEK wrapped
// under the master ENCRYPTION_KEY, and item content encrypts under the DEK.
// Rotating the master key therefore rewraps DEKs only — no content
// re-encryption.

const DEK_LENGTH = 32;

/** Generate a fresh 32-byte server-managed profile DEK. */
export function generateServerDek(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(DEK_LENGTH));
}

/**
 * Wrap a profile DEK under the master key (AES-256-GCM), AAD-bound to
 * `(orgId, profileId)` so the wrapped blob cannot be transplanted to another
 * profile. Returns self-contained base64 `iv (12) || ciphertext+tag`.
 */
export async function wrapServerDek(
  masterKeyBase64: string,
  dek: Uint8Array,
  aad: ServerDekWrapAadMeta,
): Promise<string> {
  if (dek.byteLength !== DEK_LENGTH) {
    throw new Error(`server DEK must be ${DEK_LENGTH} bytes, got ${dek.byteLength}`);
  }
  const key = await importKey(masterKeyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: ALGORITHM,
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(buildServerDekWrapAad(aad)),
      },
      key,
      toArrayBuffer(dek),
    ),
  );
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(ciphertext, iv.byteLength);
  return toBase64(combined);
}

/**
 * Unwrap a profile DEK produced by {@link wrapServerDek}. The `(orgId, profileId)`
 * AAD must match the wrap, so a blob from a different profile fails GCM
 * authentication. Throws if the recovered key is not 32 bytes.
 */
export async function unwrapServerDek(
  masterKeyBase64: string,
  wrappedBase64: string,
  aad: ServerDekWrapAadMeta,
): Promise<Uint8Array> {
  const key = await importKey(masterKeyBase64);
  const combined = fromBase64(wrappedBase64);
  const iv = combined.subarray(0, IV_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH);
  const dek = new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: ALGORITHM,
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(buildServerDekWrapAad(aad)),
      },
      key,
      toArrayBuffer(ciphertext),
    ),
  );
  if (dek.byteLength !== DEK_LENGTH) {
    throw new Error(`unwrapped server DEK must be ${DEK_LENGTH} bytes, got ${dek.byteLength}`);
  }
  return dek;
}

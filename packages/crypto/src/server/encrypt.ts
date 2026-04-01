import { fromBase64, toBase64 } from "../shared/encoding";
import type { ServerEncryptedItem } from "../shared/types";

const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12;

/** Get a clean ArrayBuffer from a Uint8Array (handles offset/length correctly). */
function toArrayBuffer(arr: Uint8Array): ArrayBuffer {
  return arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength) as ArrayBuffer;
}

async function importKey(base64Key: string): Promise<CryptoKey> {
  let raw = fromBase64(base64Key);
  // AES-256-GCM requires exactly 32 bytes. If key is longer (e.g. legacy 64-byte key),
  // use only the first 32 bytes. If shorter than 16 bytes, it's invalid.
  if (raw.byteLength > 32) {
    raw = raw.slice(0, 32);
  }
  return crypto.subtle.importKey("raw", toArrayBuffer(raw), { name: ALGORITHM }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Encrypt a payload using AES-256-GCM (server-side, for server_managed items).
 * Uses WebCrypto for Cloudflare Workers compatibility.
 */
export async function serverEncrypt(
  plaintext: Uint8Array,
  base64Key: string,
  keyVersion: number,
): Promise<ServerEncryptedItem> {
  const key = await importKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encrypted = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(plaintext),
  );

  return {
    ciphertext: toBase64(new Uint8Array(encrypted)),
    iv: toBase64(iv),
    keyVersion,
  };
}

/**
 * Decrypt a server-managed item using AES-256-GCM.
 */
export async function serverDecrypt(
  item: ServerEncryptedItem,
  base64Key: string,
): Promise<Uint8Array> {
  const key = await importKey(base64Key);
  const ciphertext = fromBase64(item.ciphertext);
  const iv = fromBase64(item.iv);

  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(ciphertext),
  );
  return new Uint8Array(decrypted);
}

import { toBase64, fromBase64 } from "../shared/encoding.js";
import type { ServerEncryptedItem } from "../shared/types.js";

const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12;

async function importKey(base64Key: string): Promise<CryptoKey> {
  const raw = fromBase64(base64Key);
  return crypto.subtle.importKey("raw", raw, { name: ALGORITHM }, false, ["encrypt", "decrypt"]);
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
  const encrypted = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, plaintext);

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

  const decrypted = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, ciphertext);
  return new Uint8Array(decrypted);
}

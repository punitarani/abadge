import { randomBytes, toBase64 } from "./encoding.js";
import type { GeneratedApiKey } from "./types.js";

/**
 * Generate a new API key with the given prefix.
 * Returns the full key (show once), its SHA-256 hash (store), and prefix (for lookup).
 */
export async function generateApiKey(prefix: string): Promise<GeneratedApiKey> {
  const secret = randomBytes(32);
  const key = `${prefix}${toBase64(secret)}`;
  const hash = await hashApiKey(key);
  return { key, hash, prefix: key.slice(0, 8) };
}

/** SHA-256 hash of an API key, returned as base64url. */
export async function hashApiKey(key: string): Promise<string> {
  const encoded = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return toBase64(new Uint8Array(digest));
}

/**
 * Constant-time comparison of two strings.
 * Both strings are hashed first to normalize length, then compared byte-by-byte.
 */
export async function verifyApiKey(candidate: string, storedHash: string): Promise<boolean> {
  const candidateHash = await hashApiKey(candidate);
  if (candidateHash.length !== storedHash.length) return false;

  let result = 0;
  for (let i = 0; i < candidateHash.length; i++) {
    result |= candidateHash.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return result === 0;
}

import { randomBytes, toBase64 } from "./encoding";
import type { GeneratedApiKey } from "./types";

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

/**
 * Generate a uniformly-distributed numeric OTP (default 6 digits) via rejection
 * sampling over CSPRNG bytes — no modulo bias. Used for the auth.md claim
 * ceremony; the code is emailed in plaintext and stored only as a hash.
 */
export function generateNumericOtp(digits = 6): string {
  let out = "";
  const buf = new Uint8Array(1);
  while (out.length < digits) {
    crypto.getRandomValues(buf);
    const b = buf[0] ?? 0;
    // Reject the top range (250–255) that would bias modulo 10.
    if (b < 250) out += String(b % 10);
  }
  return out;
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

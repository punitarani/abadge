/** Convert Uint8Array to unpadded base64url string. */
export function toBase64(data: Uint8Array): string {
  const binary = String.fromCharCode(...data);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Convert unpadded base64url string to Uint8Array. */
export function fromBase64(encoded: string): Uint8Array {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Generate cryptographically random bytes. */
export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** Generate a 16-byte random salt for KDF. */
export function generateSalt(): Uint8Array {
  return randomBytes(16);
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Encode bytes as base32 (RFC 4648) without padding. */
export function toBase32(data: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let result = "";

  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += BASE32_ALPHABET[(value >>> bits) & 0x1f];
    }
  }

  if (bits > 0) {
    result += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }

  return result;
}

/** Decode base32 (RFC 4648) string to bytes. Ignores dashes and spaces. */
export function fromBase32(encoded: string): Uint8Array {
  const clean = encoded.replace(/[-\s]/g, "").toUpperCase();
  const output: number[] = [];
  let bits = 0;
  let value = 0;

  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((value >>> bits) & 0xff);
    }
  }

  return new Uint8Array(output);
}

/** Format a base32 string with dashes every 5 characters for display. */
export function formatRecoveryKey(base32: string): string {
  return base32.match(/.{1,5}/g)?.join("-") ?? base32;
}

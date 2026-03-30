const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12;

async function importKey(base64Key: string): Promise<CryptoKey> {
  const rawKey = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("raw", rawKey, { name: ALGORITHM }, false, ["encrypt", "decrypt"]);
}

export async function encrypt(
  plaintext: string,
  base64Key: string,
): Promise<{ ciphertext: string; iv: string }> {
  const key = await importKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);

  const encrypted = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, encoded);

  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    iv: btoa(String.fromCharCode(...iv)),
  };
}

export async function decrypt(ciphertext: string, iv: string, base64Key: string): Promise<string> {
  const key = await importKey(base64Key);
  const encryptedBytes = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
  const ivBytes = Uint8Array.from(atob(iv), (c) => c.charCodeAt(0));

  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: ivBytes },
    key,
    encryptedBytes,
  );

  return new TextDecoder().decode(decrypted);
}

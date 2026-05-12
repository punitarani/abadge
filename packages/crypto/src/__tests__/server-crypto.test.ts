import { describe, expect, test } from "bun:test";
import { serverDecrypt, serverEncrypt } from "../server/encrypt";
import { toBase64 } from "../shared/encoding";

// Generate a test server key (32 bytes, base64url)
const TEST_SERVER_KEY = toBase64(crypto.getRandomValues(new Uint8Array(32)));

describe("Server-managed encryption", () => {
  test("encrypt and decrypt round-trip", async () => {
    const plaintext = new TextEncoder().encode(
      JSON.stringify({ v: 1, label: "db-password", kind: "login", fields: { password: "s3cret" } }),
    );

    const encrypted = await serverEncrypt(plaintext, TEST_SERVER_KEY, 1);
    expect(encrypted.ciphertext.length).toBeGreaterThan(0);
    expect(encrypted.iv.length).toBeGreaterThan(0);
    expect(encrypted.keyVersion).toBe(1);

    const decrypted = await serverDecrypt(encrypted, TEST_SERVER_KEY);
    expect(new TextDecoder().decode(decrypted)).toBe(new TextDecoder().decode(plaintext));
  });

  test("wrong key fails to decrypt", async () => {
    const wrongKey = toBase64(crypto.getRandomValues(new Uint8Array(32)));
    const plaintext = new TextEncoder().encode("secret");

    const encrypted = await serverEncrypt(plaintext, TEST_SERVER_KEY, 1);
    expect(serverDecrypt(encrypted, wrongKey)).rejects.toThrow();
  });

  test("tampered ciphertext fails", async () => {
    const plaintext = new TextEncoder().encode("secret");
    const encrypted = await serverEncrypt(plaintext, TEST_SERVER_KEY, 1);

    // Flip the last byte of the base64url ciphertext to a deterministically-
    // different character. The previous version used a fixed "AA" suffix which
    // produced a no-op tampering ~1/256 of the time (when the original ciphertext
    // already ended in "AA"), causing intermittent CI flakes.
    const last = encrypted.ciphertext.slice(-1);
    const replacement = last === "A" ? "B" : "A";
    const tampered = { ...encrypted, ciphertext: `${encrypted.ciphertext.slice(0, -1)}${replacement}` };
    expect(serverDecrypt(tampered, TEST_SERVER_KEY)).rejects.toThrow();
  });

  test("each encryption produces different output", async () => {
    const plaintext = new TextEncoder().encode("same-value");
    const a = await serverEncrypt(plaintext, TEST_SERVER_KEY, 1);
    const b = await serverEncrypt(plaintext, TEST_SERVER_KEY, 1);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });
});

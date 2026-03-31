import { describe, expect, test } from "bun:test";
import { decrypt, encrypt, hashToken } from "./crypto";

const TEST_KEY = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const WRONG_KEY = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

describe("encrypt/decrypt", () => {
  test("encrypt then decrypt returns original plaintext", async () => {
    const plaintext = "super-secret-api-key-12345";
    const { ciphertext, iv } = await encrypt(plaintext, TEST_KEY);
    const result = await decrypt(ciphertext, iv, TEST_KEY);
    expect(result).toBe(plaintext);
  });

  test("two encryptions of same plaintext produce different ciphertexts", async () => {
    const plaintext = "same-value";
    const a = await encrypt(plaintext, TEST_KEY);
    const b = await encrypt(plaintext, TEST_KEY);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });

  test("decrypt with wrong key throws", async () => {
    const { ciphertext, iv } = await encrypt("secret", TEST_KEY);
    expect(decrypt(ciphertext, iv, WRONG_KEY)).rejects.toThrow();
  });
});

describe("hashToken", () => {
  test("consistent hash for same input", async () => {
    const hash1 = await hashToken("agent-key-abc");
    const hash2 = await hashToken("agent-key-abc");
    expect(hash1).toBe(hash2);
  });

  test("different hash for different inputs", async () => {
    const hash1 = await hashToken("key-one");
    const hash2 = await hashToken("key-two");
    expect(hash1).not.toBe(hash2);
  });
});

import { describe, expect, test } from "bun:test";
import {
  decryptItem,
  deserializeItemPayload,
  encryptItem,
  rekeyItem,
  serializeItemPayload,
} from "../client/items.js";
import { deriveKEK } from "../client/kdf.js";
import {
  generateRecoveryKey,
  generateRootKey,
  recoverRootKey,
  unwrapRootKey,
  wrapRootKey,
  zeroKey,
} from "../client/keys.js";
import { generateSalt, toBase64 } from "../shared/encoding.js";
import type { KDFParams } from "../shared/types.js";

// Use fast KDF params for tests
const TEST_KDF_PARAMS: KDFParams = {
  algorithm: "argon2id",
  memory: 1024, // 1 MiB instead of 64 MiB
  iterations: 1,
  parallelism: 1,
  hashLength: 32,
};

describe("KDF", () => {
  test("deriveKEK produces 32 bytes", () => {
    const salt = generateSalt();
    const kek = deriveKEK("test-password", salt, TEST_KDF_PARAMS);
    expect(kek.length).toBe(32);
  });

  test("same password + salt = same KEK", () => {
    const salt = generateSalt();
    const kek1 = deriveKEK("test-password", salt, TEST_KDF_PARAMS);
    const kek2 = deriveKEK("test-password", salt, TEST_KDF_PARAMS);
    expect(toBase64(kek1)).toBe(toBase64(kek2));
  });

  test("different password = different KEK", () => {
    const salt = generateSalt();
    const kek1 = deriveKEK("password-a", salt, TEST_KDF_PARAMS);
    const kek2 = deriveKEK("password-b", salt, TEST_KDF_PARAMS);
    expect(toBase64(kek1)).not.toBe(toBase64(kek2));
  });

  test("different salt = different KEK", () => {
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    const kek1 = deriveKEK("same-password", salt1, TEST_KDF_PARAMS);
    const kek2 = deriveKEK("same-password", salt2, TEST_KDF_PARAMS);
    expect(toBase64(kek1)).not.toBe(toBase64(kek2));
  });
});

describe("Root key management", () => {
  test("generateRootKey produces 32 bytes", () => {
    const rk = generateRootKey();
    expect(rk.length).toBe(32);
  });

  test("wrap and unwrap root key round-trip", () => {
    const rk = generateRootKey();
    const salt = generateSalt();
    const kek = deriveKEK("my-password", salt, TEST_KDF_PARAMS);

    const wrapped = wrapRootKey(rk, kek);
    const unwrapped = unwrapRootKey(wrapped, kek);
    expect(toBase64(unwrapped)).toBe(toBase64(rk));
  });

  test("wrong KEK fails to unwrap", () => {
    const rk = generateRootKey();
    const salt = generateSalt();
    const kek = deriveKEK("correct-password", salt, TEST_KDF_PARAMS);
    const wrongKek = deriveKEK("wrong-password", salt, TEST_KDF_PARAMS);

    const wrapped = wrapRootKey(rk, kek);
    expect(() => unwrapRootKey(wrapped, wrongKek)).toThrow();
  });
});

describe("Recovery key", () => {
  test("generate and recover round-trip", () => {
    const rk = generateRootKey();
    const { recoveryKey, wrappedRootKey } = generateRecoveryKey(rk);

    expect(recoveryKey).toContain("-"); // formatted with dashes
    const recovered = recoverRootKey(recoveryKey, wrappedRootKey);
    expect(toBase64(recovered)).toBe(toBase64(rk));
  });
});

describe("Item encryption", () => {
  test("encrypt and decrypt round-trip", () => {
    const rk = generateRootKey();
    const payload = { v: 1, label: "test", kind: "login", fields: { password: "s3cret" } };
    const plaintext = serializeItemPayload(payload);

    const encrypted = encryptItem(plaintext, rk);
    expect(encrypted.encryptedItemKey.length).toBeGreaterThan(0);
    expect(encrypted.ciphertext.length).toBeGreaterThan(0);

    const decrypted = decryptItem(encrypted, rk);
    const result = deserializeItemPayload(decrypted);
    expect(result).toEqual(payload);
  });

  test("wrong root key fails to decrypt", () => {
    const rk1 = generateRootKey();
    const rk2 = generateRootKey();
    const plaintext = serializeItemPayload({ v: 1, label: "test", kind: "opaque", fields: {} });

    const encrypted = encryptItem(plaintext, rk1);
    expect(() => decryptItem(encrypted, rk2)).toThrow();
  });

  test("tampered ciphertext fails", () => {
    const rk = generateRootKey();
    const plaintext = serializeItemPayload({ v: 1, label: "test", kind: "opaque", fields: {} });

    const encrypted = encryptItem(plaintext, rk);
    // Flip a byte in the ciphertext
    const tampered = { ...encrypted, ciphertext: encrypted.ciphertext.slice(0, -2) + "AA" };
    expect(() => decryptItem(tampered, rk)).toThrow();
  });

  test("each encryption produces different ciphertext (random DEK + nonces)", () => {
    const rk = generateRootKey();
    const plaintext = serializeItemPayload({ v: 1, label: "test", kind: "opaque", fields: {} });

    const a = encryptItem(plaintext, rk);
    const b = encryptItem(plaintext, rk);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.encryptedItemKey).not.toBe(b.encryptedItemKey);
  });
});

describe("Item rekeying", () => {
  test("rekey preserves plaintext", () => {
    const oldRk = generateRootKey();
    const newRk = generateRootKey();
    const payload = { v: 1, label: "test", kind: "token", fields: { token: "abc123" } };
    const plaintext = serializeItemPayload(payload);

    const encrypted = encryptItem(plaintext, oldRk);
    const newEncryptedItemKey = rekeyItem(encrypted.encryptedItemKey, oldRk, newRk);

    // Decrypt with new root key
    const rekeyed = { encryptedItemKey: newEncryptedItemKey, ciphertext: encrypted.ciphertext };
    const decrypted = decryptItem(rekeyed, newRk);
    expect(deserializeItemPayload(decrypted)).toEqual(payload);
  });

  test("old root key cannot decrypt rekeyed item", () => {
    const oldRk = generateRootKey();
    const newRk = generateRootKey();
    const plaintext = serializeItemPayload({ v: 1, label: "x", kind: "opaque", fields: {} });

    const encrypted = encryptItem(plaintext, oldRk);
    const newEncryptedItemKey = rekeyItem(encrypted.encryptedItemKey, oldRk, newRk);

    const rekeyed = { encryptedItemKey: newEncryptedItemKey, ciphertext: encrypted.ciphertext };
    expect(() => decryptItem(rekeyed, oldRk)).toThrow();
  });
});

describe("zeroKey", () => {
  test("zeros key material", () => {
    const key = generateRootKey();
    expect(key.some((b) => b !== 0)).toBe(true);
    zeroKey(key);
    expect(key.every((b) => b === 0)).toBe(true);
  });
});

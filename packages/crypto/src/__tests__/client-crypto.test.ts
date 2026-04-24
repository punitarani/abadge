import { describe, expect, test } from "bun:test";
import {
  decryptItem,
  deserializeItemPayload,
  encryptItem,
  rekeyItem,
  serializeItemPayload,
} from "../client/items";
import { deriveKEK } from "../client/kdf";
import {
  generateRecoveryKey,
  generateRootKey,
  recoverRootKey,
  unwrapRootKey,
  wrapRootKey,
  zeroKey,
} from "../client/keys";
import { fromBase64, generateSalt, toBase64 } from "../shared/encoding";
import type { KDFParams } from "../shared/types";

// Use fast KDF params for tests
const TEST_KDF_PARAMS: KDFParams = {
  algorithm: "argon2id",
  memory: 1024, // 1 MiB instead of 64 MiB
  iterations: 1,
  parallelism: 1,
  hashLength: 32,
};

// Shared AAD meta — pinned so swap-test assertions can name specific fields.
const PROFILE_ID = "prof_main";
const ITEM_ID = "item_main";
const ROOT_META = { profileId: PROFILE_ID, keyVersion: 1 };

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

    const wrapped = wrapRootKey(rk, kek, ROOT_META);
    const unwrapped = unwrapRootKey(wrapped, kek, ROOT_META);
    expect(toBase64(unwrapped)).toBe(toBase64(rk));
  });

  test("wrong KEK fails to unwrap", () => {
    const rk = generateRootKey();
    const salt = generateSalt();
    const kek = deriveKEK("correct-password", salt, TEST_KDF_PARAMS);
    const wrongKek = deriveKEK("wrong-password", salt, TEST_KDF_PARAMS);

    const wrapped = wrapRootKey(rk, kek, ROOT_META);
    expect(() => unwrapRootKey(wrapped, wrongKek, ROOT_META)).toThrow();
  });

  // §W1S7-001 — root-wrap AAD binds to (profileId, keyVersion).

  test("§W1S7-001: cross-profile wrapped root key rejected", () => {
    const rk = generateRootKey();
    const kek = deriveKEK("pw", generateSalt(), TEST_KDF_PARAMS);
    const wrapped = wrapRootKey(rk, kek, { profileId: "prof_a", keyVersion: 1 });
    expect(() => unwrapRootKey(wrapped, kek, { profileId: "prof_b", keyVersion: 1 })).toThrow();
  });

  test("§W1S7-001: stale keyVersion wrapped root key rejected", () => {
    const rk = generateRootKey();
    const kek = deriveKEK("pw", generateSalt(), TEST_KDF_PARAMS);
    const wrapped = wrapRootKey(rk, kek, { profileId: "prof_a", keyVersion: 1 });
    // A wrap from keyVersion=1 must not be unwrappable at keyVersion=2 even with
    // the correct KEK — protects against replaying a pre-rotation wrap.
    expect(() => unwrapRootKey(wrapped, kek, { profileId: "prof_a", keyVersion: 2 })).toThrow();
  });
});

describe("Recovery key", () => {
  test("generate and recover round-trip", () => {
    const rk = generateRootKey();
    const { recoveryKey, wrappedRootKey } = generateRecoveryKey(rk, ROOT_META);

    expect(recoveryKey).toContain("-"); // formatted with dashes
    const recovered = recoverRootKey(recoveryKey, wrappedRootKey, ROOT_META);
    expect(toBase64(recovered)).toBe(toBase64(rk));
  });

  test("§W1S7-001: cross-profile recovery wrap rejected", () => {
    const rk = generateRootKey();
    const { recoveryKey, wrappedRootKey } = generateRecoveryKey(rk, {
      profileId: "prof_a",
      keyVersion: 1,
    });
    expect(() =>
      recoverRootKey(recoveryKey, wrappedRootKey, {
        profileId: "prof_b",
        keyVersion: 1,
      }),
    ).toThrow();
  });
});

describe("Item encryption", () => {
  const META = { profileId: PROFILE_ID, itemId: ITEM_ID, contentVersion: 1 };

  test("encrypt and decrypt round-trip", () => {
    const rk = generateRootKey();
    const payload = { v: 1, label: "test", kind: "login", fields: { password: "s3cret" } };
    const plaintext = serializeItemPayload(payload);

    const encrypted = encryptItem(plaintext, rk, META);
    expect(encrypted.encryptedItemKey.length).toBeGreaterThan(0);
    expect(encrypted.ciphertext.length).toBeGreaterThan(0);

    const decrypted = decryptItem(encrypted, rk, META);
    const result = deserializeItemPayload(decrypted);
    expect(result).toEqual(payload);
  });

  test("wrong root key fails to decrypt", () => {
    const rk1 = generateRootKey();
    const rk2 = generateRootKey();
    const plaintext = serializeItemPayload({ v: 1, label: "test", kind: "opaque", fields: {} });

    const encrypted = encryptItem(plaintext, rk1, META);
    expect(() => decryptItem(encrypted, rk2, META)).toThrow();
  });

  test("tampered ciphertext fails", () => {
    const rk = generateRootKey();
    const plaintext = serializeItemPayload({ v: 1, label: "test", kind: "opaque", fields: {} });

    const encrypted = encryptItem(plaintext, rk, META);
    const tamperedCiphertext = fromBase64(encrypted.ciphertext);
    tamperedCiphertext[tamperedCiphertext.length - 1] ^= 0x01;
    const tampered = { ...encrypted, ciphertext: toBase64(tamperedCiphertext) };
    expect(() => decryptItem(tampered, rk, META)).toThrow();
  });

  test("each encryption produces different ciphertext (random DEK + nonces)", () => {
    const rk = generateRootKey();
    const plaintext = serializeItemPayload({ v: 1, label: "test", kind: "opaque", fields: {} });

    const a = encryptItem(plaintext, rk, META);
    const b = encryptItem(plaintext, rk, META);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.encryptedItemKey).not.toBe(b.encryptedItemKey);
  });

  // §W1S7-001 — AAD binds ciphertext to (profileId, itemId, contentVersion).

  test("§W1S7-001: cross-item decrypt rejected (DEK-wrap AAD swap)", () => {
    // Swap the (encryptedItemKey, ciphertext) pair between two items in the
    // same profile, then attempt to decrypt one under the other's identity.
    // Pre-AAD: decrypt succeeded silently — this test would fail to throw.
    const rk = generateRootKey();
    const plaintextA = serializeItemPayload({
      v: 1,
      label: "A",
      kind: "opaque",
      fields: { value: "A" },
    });
    const encA = encryptItem(plaintextA, rk, {
      profileId: PROFILE_ID,
      itemId: "item_A",
      contentVersion: 1,
    });
    expect(() =>
      decryptItem(encA, rk, { profileId: PROFILE_ID, itemId: "item_B", contentVersion: 1 }),
    ).toThrow();
  });

  test("§W1S7-001: cross-profile decrypt rejected", () => {
    const rk = generateRootKey();
    const enc = encryptItem(serializeItemPayload({ x: 1 }), rk, {
      profileId: "prof_a",
      itemId: ITEM_ID,
      contentVersion: 1,
    });
    expect(() =>
      decryptItem(enc, rk, { profileId: "prof_b", itemId: ITEM_ID, contentVersion: 1 }),
    ).toThrow();
  });

  test("§W1S7-001: cross-contentVersion decrypt rejected", () => {
    // Content AAD binds to `contentVersion`; attempting to decrypt a v=1 row
    // with v=2 metadata must fail even with the correct root key + ids.
    const rk = generateRootKey();
    const enc = encryptItem(serializeItemPayload({ x: 1 }), rk, {
      profileId: PROFILE_ID,
      itemId: ITEM_ID,
      contentVersion: 1,
    });
    expect(() =>
      decryptItem(enc, rk, { profileId: PROFILE_ID, itemId: ITEM_ID, contentVersion: 2 }),
    ).toThrow();
  });
});

describe("Item rekeying", () => {
  const META = { profileId: PROFILE_ID, itemId: ITEM_ID, contentVersion: 1 };
  const REKEY_META = { profileId: PROFILE_ID, itemId: ITEM_ID };

  test("rekey preserves plaintext", () => {
    const oldRk = generateRootKey();
    const newRk = generateRootKey();
    const payload = { v: 1, label: "test", kind: "token", fields: { token: "abc123" } };
    const plaintext = serializeItemPayload(payload);

    const encrypted = encryptItem(plaintext, oldRk, META);
    const newEncryptedItemKey = rekeyItem(encrypted.encryptedItemKey, oldRk, newRk, REKEY_META);

    // Decrypt with new root key
    const rekeyed = { encryptedItemKey: newEncryptedItemKey, ciphertext: encrypted.ciphertext };
    const decrypted = decryptItem(rekeyed, newRk, META);
    expect(deserializeItemPayload(decrypted)).toEqual(payload);
  });

  test("old root key cannot decrypt rekeyed item", () => {
    const oldRk = generateRootKey();
    const newRk = generateRootKey();
    const plaintext = serializeItemPayload({ v: 1, label: "x", kind: "opaque", fields: {} });

    const encrypted = encryptItem(plaintext, oldRk, META);
    const newEncryptedItemKey = rekeyItem(encrypted.encryptedItemKey, oldRk, newRk, REKEY_META);

    const rekeyed = { encryptedItemKey: newEncryptedItemKey, ciphertext: encrypted.ciphertext };
    expect(() => decryptItem(rekeyed, oldRk, META)).toThrow();
  });

  test("§W1S7-001: rekey with wrong DEK-wrap meta rejected", () => {
    // A rekey attempt under a different itemId must fail the unwrap step —
    // a rotate that mis-binds the DEK-wrap cannot silently produce a valid
    // new wrap against an attacker-chosen identity.
    const oldRk = generateRootKey();
    const newRk = generateRootKey();
    const encrypted = encryptItem(serializeItemPayload({ x: 1 }), oldRk, {
      profileId: PROFILE_ID,
      itemId: "item_real",
      contentVersion: 1,
    });
    expect(() =>
      rekeyItem(encrypted.encryptedItemKey, oldRk, newRk, {
        profileId: PROFILE_ID,
        itemId: "item_fake",
      }),
    ).toThrow();
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

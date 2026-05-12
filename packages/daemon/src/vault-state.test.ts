/**
 * Unit coverage for VaultState — the in-memory root-key custody class.
 * Auto-lock + changePassword + rekey paths are exercised here directly,
 * without the daemon socket layer (which has its own integration tests).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { KDFParams } from "@abadge/crypto";
import {
  deriveKEK,
  generateRootKey,
  generateSalt,
  toBase64,
  wrapRootKey,
  zeroKey,
} from "@abadge/crypto";
import type { VaultMeta } from "./types";
import { VaultState } from "./vault-state";

const TEST_KDF_PARAMS: KDFParams = {
  algorithm: "argon2id",
  memory: 1024,
  iterations: 1,
  parallelism: 1,
  hashLength: 32,
};

let cachedMeta: VaultMeta | null = null;
const PASSWORD = "test-master-password";
const PROFILE_ID = "vs-test-profile";

beforeAll(() => {
  // Build a real wrapped root key once for the suite.
  const salt = generateSalt();
  const kek = deriveKEK(PASSWORD, salt, TEST_KDF_PARAMS);
  const rootKey = generateRootKey();
  const wrapped = wrapRootKey(rootKey, kek, { profileId: PROFILE_ID, keyVersion: 1 });
  zeroKey(kek);
  zeroKey(rootKey);
  cachedMeta = {
    id: PROFILE_ID,
    wrappedRootKey: wrapped.wrapped,
    kdfSalt: toBase64(salt),
    keyVersion: 1,
    kdfParams: TEST_KDF_PARAMS,
  };
});

function meta(): VaultMeta {
  if (!cachedMeta) throw new Error("test setup not run");
  return cachedMeta;
}

afterAll(() => {
  cachedMeta = null;
});

// ---------------------------------------------------------------------------
// Lock / unlock state
// ---------------------------------------------------------------------------

describe("VaultState locked / unlocked state", () => {
  test("starts locked; keyVersion is 0 before unlock", () => {
    const v = new VaultState(60_000);
    expect(v.locked).toBe(true);
    expect(v.keyVersion).toBe(0);
  });

  test("unlock with correct password leaves the vault unlocked + reflects keyVersion", () => {
    const v = new VaultState(60_000);
    v.unlock(PASSWORD, meta());
    expect(v.locked).toBe(false);
    expect(v.keyVersion).toBe(1);
    v.lock();
  });

  test("unlock with wrong password throws and leaves the vault locked", () => {
    const v = new VaultState(60_000);
    expect(() => v.unlock("wrong-password", meta())).toThrow();
    expect(v.locked).toBe(true);
  });

  test("lock zeros the root key (locked=true after lock)", () => {
    const v = new VaultState(60_000);
    v.unlock(PASSWORD, meta());
    expect(v.locked).toBe(false);
    v.lock();
    expect(v.locked).toBe(true);
    // Idempotent: locking again must not throw.
    v.lock();
    expect(v.locked).toBe(true);
  });

  test("requireUnlocked-style ops throw when locked (encrypt/decrypt/changePassword/rekey)", () => {
    const v = new VaultState(60_000);
    const enc = () => v.encrypt({}, { profileId: "p", itemId: "i" });
    const dec = () => v.decrypt("eik", "ct", { profileId: "p", itemId: "i" });
    const cp = () => v.changePassword(PASSWORD, "new", meta());
    const rk = () => v.rekey([], new Uint8Array(32), { profileId: "p" });
    for (const op of [enc, dec, cp, rk]) {
      expect(op).toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// changePassword
// ---------------------------------------------------------------------------

describe("VaultState.changePassword", () => {
  test("returns a new wrappedRootKey, kdfSalt, and kdfParams when old password is correct", () => {
    const v = new VaultState(60_000);
    v.unlock(PASSWORD, meta());
    const out = v.changePassword(PASSWORD, "new-password-123", meta());
    expect(out.wrappedRootKey).toBeTruthy();
    expect(out.wrappedRootKey).not.toBe(meta().wrappedRootKey);
    expect(out.kdfSalt).toBeTruthy();
    expect(out.kdfSalt).not.toBe(meta().kdfSalt);
    expect(out.kdfParams).toEqual(TEST_KDF_PARAMS);
    v.lock();
  });

  test("rejects when the supplied old password does not unwrap the meta", () => {
    const v = new VaultState(60_000);
    v.unlock(PASSWORD, meta());
    expect(() => v.changePassword("the-wrong-old-password", "new-password", meta())).toThrow();
    // Vault must still be unlocked — a failed password change does not lock.
    expect(v.locked).toBe(false);
    v.lock();
  });
});

// ---------------------------------------------------------------------------
// rekey
// ---------------------------------------------------------------------------

describe("VaultState.rekey", () => {
  test("with an empty items list returns an empty results list", () => {
    const v = new VaultState(60_000);
    v.unlock(PASSWORD, meta());
    const out = v.rekey([], new Uint8Array(32), { profileId: PROFILE_ID });
    expect(out).toEqual([]);
    v.lock();
  });

  test("rekey on a locked vault throws with the canonical 'locked' message", () => {
    const v = new VaultState(60_000);
    expect(() => v.rekey([], new Uint8Array(32), { profileId: PROFILE_ID })).toThrow(/locked/i);
  });
});

// ---------------------------------------------------------------------------
// Encrypt / decrypt round-trip + AAD
// ---------------------------------------------------------------------------

describe("VaultState.encrypt + .decrypt round-trip", () => {
  test("encrypt then decrypt returns the original payload (parsed)", () => {
    const v = new VaultState(60_000);
    v.unlock(PASSWORD, meta());
    const aad = { profileId: PROFILE_ID, itemId: "it-1", contentVersion: 1 };
    const enc = v.encrypt({ v: 1, secret: "abc" }, aad);
    const out = v.decrypt(enc.encryptedItemKey, enc.ciphertext, aad);
    expect(out).toEqual({ v: 1, secret: "abc" });
    v.lock();
  });

  test("decrypt with mismatched itemId AAD fails the AEAD tag check", () => {
    const v = new VaultState(60_000);
    v.unlock(PASSWORD, meta());
    const enc = v.encrypt(
      { v: 1, secret: "guarded" },
      { profileId: PROFILE_ID, itemId: "it-bound", contentVersion: 1 },
    );
    expect(() =>
      v.decrypt(enc.encryptedItemKey, enc.ciphertext, {
        profileId: PROFILE_ID,
        itemId: "it-different",
        contentVersion: 1,
      }),
    ).toThrow();
    v.lock();
  });

  test("decrypt with mismatched profileId AAD fails the AEAD tag check", () => {
    const v = new VaultState(60_000);
    v.unlock(PASSWORD, meta());
    const enc = v.encrypt({ v: 1 }, { profileId: PROFILE_ID, itemId: "it-cp" });
    expect(() =>
      v.decrypt(enc.encryptedItemKey, enc.ciphertext, {
        profileId: "other-profile",
        itemId: "it-cp",
      }),
    ).toThrow();
    v.lock();
  });
});

// ---------------------------------------------------------------------------
// Auto-lock timer
// ---------------------------------------------------------------------------

describe("VaultState auto-lock", () => {
  test("auto-lock callback fires after autoLockMs of inactivity", async () => {
    const v = new VaultState(50);
    let fired = false;
    v.setAutoLockCallback(() => {
      fired = true;
      v.lock();
    });

    v.unlock(PASSWORD, meta());
    expect(v.locked).toBe(false);

    // Wait past the autoLockMs window.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(fired).toBe(true);
    expect(v.locked).toBe(true);
  });

  test("each operation resets the auto-lock timer (no premature lock)", async () => {
    const v = new VaultState(80);
    let fired = false;
    v.setAutoLockCallback(() => {
      fired = true;
    });
    v.unlock(PASSWORD, meta());

    // Tick faster than the lock timeout — operations should keep extending it.
    for (let i = 0; i < 4; i++) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      v.encrypt({ i }, { profileId: PROFILE_ID, itemId: `i-${i}` });
    }

    // Only ~120 ms have passed since the last operation; the timer must not
    // have fired (the ~30ms-between-ops resets it well below 80 ms).
    expect(fired).toBe(false);

    // Now wait past the window.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(fired).toBe(true);
    v.lock();
  });

  test("lock() clears the auto-lock timer (idempotent)", () => {
    const v = new VaultState(60_000);
    let fired = false;
    v.setAutoLockCallback(() => {
      fired = true;
    });
    v.unlock(PASSWORD, meta());
    v.lock();
    // No throw, no fire — the timer was cleared.
    expect(fired).toBe(false);
  });
});

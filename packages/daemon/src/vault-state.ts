import type { EncryptedItem, KDFParams, WrappedKey } from "@abadge/crypto";
import {
  decryptItem,
  deriveKEK,
  deserializeItemPayload,
  encryptItem,
  fromBase64,
  generateSalt,
  rekeyItem,
  serializeItemPayload,
  toBase64,
  unwrapRootKey,
  wrapRootKey,
  zeroKey,
} from "@abadge/crypto";
import type { EncryptResult, RekeyItemResult, VaultMeta } from "./types";

/**
 * In-memory vault state. Holds the unlocked root key and vault metadata.
 * All crypto operations go through this object so zeroing is centralized.
 */
export class VaultState {
  private rootKey: Uint8Array | null = null;
  private meta: VaultMeta | null = null;
  private autoLockTimer: ReturnType<typeof setTimeout> | null = null;
  private autoLockMs: number;
  private onAutoLock: (() => void) | null = null;

  constructor(autoLockMs: number) {
    this.autoLockMs = autoLockMs;
  }

  get locked(): boolean {
    return this.rootKey === null;
  }

  get keyVersion(): number {
    return this.meta?.keyVersion ?? 0;
  }

  /** Register a callback invoked when auto-lock fires. */
  setAutoLockCallback(cb: () => void): void {
    this.onAutoLock = cb;
  }

  /** Unlock the vault: derive KEK from password, unwrap root key, hold in memory. */
  unlock(password: string, meta: VaultMeta): void {
    const salt = fromBase64(meta.kdfSalt);
    const kek = deriveKEK(password, salt, meta.kdfParams);
    const wrapped: WrappedKey = { wrapped: meta.wrappedRootKey };

    // AAD binds the wrapped root key to (profileId, keyVersion). unwrapRootKey
    // throws if the password is wrong OR the AAD does not match the
    // server-supplied meta — the latter catches a profile-swap or stale-
    // keyVersion replay before the root key lands in memory.
    const rootKey = unwrapRootKey(wrapped, kek, {
      profileId: meta.id,
      keyVersion: meta.keyVersion,
    });
    zeroKey(kek);

    this.rootKey = rootKey;
    this.meta = meta;
    this.resetAutoLock();
  }

  /** Lock the vault: zero root key from memory. */
  lock(): void {
    if (this.rootKey) {
      zeroKey(this.rootKey);
      this.rootKey = null;
    }
    this.clearAutoLock();
  }

  /** Change password: re-derive KEK with new password, re-wrap root key. */
  changePassword(
    oldPassword: string,
    newPassword: string,
    meta: VaultMeta,
  ): { wrappedRootKey: string; kdfSalt: string; kdfParams: KDFParams } {
    const rootKey = this.requireUnlocked();

    // Verify old password by attempting unwrap. AAD binds (profileId,
    // keyVersion); the re-wrap below reuses the same meta. A password change
    // does NOT advance keyVersion, so the server-side UPDATE stays symmetric
    // with this unwrap.
    const aadMeta = { profileId: meta.id, keyVersion: meta.keyVersion };
    const oldSalt = fromBase64(meta.kdfSalt);
    const oldKek = deriveKEK(oldPassword, oldSalt, meta.kdfParams);
    const oldWrapped: WrappedKey = { wrapped: meta.wrappedRootKey };
    const verified = unwrapRootKey(oldWrapped, oldKek, aadMeta);
    zeroKey(oldKek);
    zeroKey(verified);

    const newSalt = generateSalt();
    const newKek = deriveKEK(newPassword, newSalt, meta.kdfParams);
    const newWrapped = wrapRootKey(rootKey, newKek, aadMeta);
    zeroKey(newKek);

    this.resetAutoLock();

    return {
      wrappedRootKey: newWrapped.wrapped,
      kdfSalt: toBase64(newSalt),
      kdfParams: meta.kdfParams,
    };
  }

  /**
   * Encrypt an item payload. Callers supply the identity the ciphertext will
   * be stored under so it can be bound as AAD. `contentVersion` defaults to
   * `1` on create; on rewrite, callers MUST pass the NEW version the row will
   * take.
   */
  encrypt(
    payload: unknown,
    meta: { profileId: string; itemId: string; contentVersion?: number },
  ): EncryptResult {
    const rootKey = this.requireUnlocked();
    const plaintext = serializeItemPayload(payload);
    const result = encryptItem(plaintext, rootKey, meta);
    this.resetAutoLock();
    return result;
  }

  /**
   * Decrypt an item. The same `{profileId, itemId, contentVersion}` used at
   * encrypt time is required — any mismatch fails the AEAD tag check and
   * throws from `decryptItem`.
   */
  decrypt(
    encryptedItemKey: string,
    ciphertext: string,
    meta: { profileId: string; itemId: string; contentVersion?: number },
  ): unknown {
    const rootKey = this.requireUnlocked();
    const item: EncryptedItem = { encryptedItemKey, ciphertext };
    const bytes = decryptItem(item, rootKey, meta);
    const payload = deserializeItemPayload(bytes);
    this.resetAutoLock();
    return payload;
  }

  /**
   * Re-wrap item DEKs with the currently-unlocked (new) root key. Each rewrap
   * requires the item's identity so the DEK-wrap AAD stays bound across
   * rotations.
   */
  rekey(
    items: Array<{ id: string; encryptedItemKey: string }>,
    oldRootKey: Uint8Array,
    meta: { profileId: string },
  ): RekeyItemResult[] {
    const rootKey = this.requireUnlocked();
    const results = items.map((item) => ({
      id: item.id,
      newEncryptedItemKey: rekeyItem(item.encryptedItemKey, oldRootKey, rootKey, {
        profileId: meta.profileId,
        itemId: item.id,
      }),
    }));
    this.resetAutoLock();
    return results;
  }

  destroy(): void {
    this.lock();
    this.onAutoLock = null;
  }

  private requireUnlocked(): Uint8Array {
    if (this.rootKey === null) {
      throw new Error("Vault is locked");
    }
    return this.rootKey;
  }

  private resetAutoLock(): void {
    this.clearAutoLock();
    if (this.autoLockMs > 0) {
      this.autoLockTimer = setTimeout(() => {
        this.lock();
        this.onAutoLock?.();
      }, this.autoLockMs);
      // Unref so the timer doesn't prevent process exit
      if (
        this.autoLockTimer &&
        typeof this.autoLockTimer === "object" &&
        "unref" in this.autoLockTimer
      ) {
        this.autoLockTimer.unref();
      }
    }
  }

  private clearAutoLock(): void {
    if (this.autoLockTimer !== null) {
      clearTimeout(this.autoLockTimer);
      this.autoLockTimer = null;
    }
  }
}

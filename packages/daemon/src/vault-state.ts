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

    // unwrapRootKey throws if password is wrong (auth tag mismatch)
    const rootKey = unwrapRootKey(wrapped, kek);
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

    // Verify old password by attempting unwrap
    const oldSalt = fromBase64(meta.kdfSalt);
    const oldKek = deriveKEK(oldPassword, oldSalt, meta.kdfParams);
    const oldWrapped: WrappedKey = { wrapped: meta.wrappedRootKey };
    const verified = unwrapRootKey(oldWrapped, oldKek);
    zeroKey(oldKek);
    zeroKey(verified);

    const newSalt = generateSalt();
    const newKek = deriveKEK(newPassword, newSalt, meta.kdfParams);
    const newWrapped = wrapRootKey(rootKey, newKek);
    zeroKey(newKek);

    this.resetAutoLock();

    return {
      wrappedRootKey: newWrapped.wrapped,
      kdfSalt: toBase64(newSalt),
      kdfParams: meta.kdfParams,
    };
  }

  encrypt(payload: unknown): EncryptResult {
    const rootKey = this.requireUnlocked();
    const plaintext = serializeItemPayload(payload);
    const result = encryptItem(plaintext, rootKey);
    this.resetAutoLock();
    return result;
  }

  decrypt(encryptedItemKey: string, ciphertext: string): unknown {
    const rootKey = this.requireUnlocked();
    const item: EncryptedItem = { encryptedItemKey, ciphertext };
    const bytes = decryptItem(item, rootKey);
    const payload = deserializeItemPayload(bytes);
    this.resetAutoLock();
    return payload;
  }

  rekey(
    items: Array<{ id: string; encryptedItemKey: string }>,
    oldRootKey: Uint8Array,
  ): RekeyItemResult[] {
    const rootKey = this.requireUnlocked();
    const results = items.map((item) => ({
      id: item.id,
      newEncryptedItemKey: rekeyItem(item.encryptedItemKey, oldRootKey, rootKey),
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

/**
 * Client-side crypto for ZK vault operations.
 * Uses @abadge/crypto (XChaCha20-Poly1305 + Argon2id).
 */

import type { ItemPayload } from "@abadge/core";
import type { KDFParams } from "@abadge/crypto";
import {
  DEFAULT_KDF_PARAMS,
  decryptItem,
  deriveKEK,
  deserializeItemPayload,
  encryptItem,
  generateRecoveryKey as generateRecoveryKeyRaw,
  generateRootKey,
  generateSalt,
  serializeItemPayload,
  toBase64,
  unwrapRootKey,
  wrapRootKey,
  zeroKey,
} from "@abadge/crypto";
import { browserTrpcClient, getClientErrorMessage } from "./trpc-browser";

export async function bootstrapVault(
  masterPassword: string,
): Promise<{ rootKey: Uint8Array; recoveryKey: string }> {
  const salt = generateSalt();
  const kek = deriveKEK(masterPassword, salt, DEFAULT_KDF_PARAMS);
  const rootKey = generateRootKey();
  const wrapped = wrapRootKey(rootKey, kek);
  const { recoveryKey, wrappedRootKey: recoveryWrapped } = generateRecoveryKeyRaw(rootKey);

  try {
    await browserTrpcClient.vault.bootstrap.mutate({
      wrappedRootKey: wrapped.wrapped,
      kdfSalt: toBase64(salt),
      kdfParams: DEFAULT_KDF_PARAMS,
    });

    await browserTrpcClient.vault.setupRecovery.mutate({
      recoveryWrappedRootKey: recoveryWrapped.wrapped,
    });
  } catch (error) {
    zeroKey(kek);
    zeroKey(rootKey);
    throw new Error(getClientErrorMessage(error, "Bootstrap failed"));
  }

  zeroKey(kek);
  return { rootKey, recoveryKey };
}

export async function unlockVault(masterPassword: string): Promise<Uint8Array> {
  let vault: {
    wrappedRootKey: string;
    kdfSalt: string;
    kdfParams: KDFParams;
  };

  try {
    const result = await browserTrpcClient.vault.get.query();
    vault = result.vault;
  } catch (error) {
    const message = getClientErrorMessage(error, "Failed to fetch vault");
    if (message === "Vault not found") {
      throw new Error("VAULT_NOT_FOUND");
    }
    throw new Error(message);
  }

  const salt = Uint8Array.from(atob(vault.kdfSalt.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
  const kek = deriveKEK(masterPassword, salt, vault.kdfParams);

  try {
    const rootKey = unwrapRootKey({ wrapped: vault.wrappedRootKey }, kek);
    zeroKey(kek);
    return rootKey;
  } catch {
    zeroKey(kek);
    throw new Error("Incorrect master password");
  }
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ recoveryKey: string }> {
  const rootKey = await unlockVault(currentPassword);

  const newSalt = generateSalt();
  const newKek = deriveKEK(newPassword, newSalt, DEFAULT_KDF_PARAMS);
  const wrapped = wrapRootKey(rootKey, newKek);
  const { recoveryKey, wrappedRootKey: recoveryWrapped } = generateRecoveryKeyRaw(rootKey);

  try {
    await browserTrpcClient.vault.changePassword.mutate({
      wrappedRootKey: wrapped.wrapped,
      kdfSalt: toBase64(newSalt),
      kdfParams: DEFAULT_KDF_PARAMS,
    });

    await browserTrpcClient.vault.setupRecovery.mutate({
      recoveryWrappedRootKey: recoveryWrapped.wrapped,
    });
  } catch (error) {
    zeroKey(newKek);
    zeroKey(rootKey);
    throw new Error(getClientErrorMessage(error, "Password change failed"));
  }

  zeroKey(newKek);
  zeroKey(rootKey);
  return { recoveryKey };
}

export function encryptItemForVault(
  payload: ItemPayload,
  rootKey: Uint8Array,
): { encryptedItemKey: string; ciphertext: string } {
  const plaintext = serializeItemPayload(payload);
  const encrypted = encryptItem(plaintext, rootKey);
  return {
    encryptedItemKey: encrypted.encryptedItemKey,
    ciphertext: encrypted.ciphertext,
  };
}

export function decryptItemFromVault(
  encryptedItemKey: string,
  ciphertext: string,
  rootKey: Uint8Array,
): ItemPayload {
  const decrypted = decryptItem({ encryptedItemKey, ciphertext }, rootKey);
  return deserializeItemPayload<ItemPayload>(decrypted);
}

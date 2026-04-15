/**
 * Client-side crypto for ZK profile operations.
 *
 * Each function targets a specific profile by `profileId`. Profiles replace
 * the legacy per-user "vault" record; a single user can hold many profiles
 * across organizations, each with its own root key.
 *
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
  recoverRootKey,
  serializeItemPayload,
  toBase64,
  unwrapRootKey,
  wrapRootKey,
  zeroKey,
} from "@abadge/crypto";
import { browserTrpcClient, getClientErrorMessage } from "./trpc-browser";

export async function bootstrapProfile(
  profileId: string,
  masterPassword: string,
): Promise<{ rootKey: Uint8Array; recoveryKey: string }> {
  const salt = generateSalt();
  const kek = deriveKEK(masterPassword, salt, DEFAULT_KDF_PARAMS);
  const rootKey = generateRootKey();
  const wrapped = wrapRootKey(rootKey, kek);
  const { recoveryKey, wrappedRootKey: recoveryWrapped } = generateRecoveryKeyRaw(rootKey);

  try {
    await browserTrpcClient.profiles.bootstrap.mutate({
      profileId,
      wrappedRootKey: wrapped.wrapped,
      kdfSalt: toBase64(salt),
      kdfParams: DEFAULT_KDF_PARAMS,
    });

    await browserTrpcClient.profiles.setupRecovery.mutate({
      profileId,
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

export async function unlockProfile(
  profileId: string,
  masterPassword: string,
): Promise<Uint8Array> {
  let profile: {
    wrappedRootKey: string | null;
    kdfSalt: string | null;
    kdfParams: KDFParams | null;
  };

  try {
    const result = await browserTrpcClient.profiles.get.query({ profileId });
    profile = result.profile as typeof profile;
  } catch (error) {
    const message = getClientErrorMessage(error, "Failed to fetch profile");
    if (message === "Profile not found") {
      throw new Error("PROFILE_NOT_FOUND");
    }
    throw new Error(message);
  }

  if (!profile.wrappedRootKey || !profile.kdfSalt || !profile.kdfParams) {
    throw new Error("PROFILE_NOT_BOOTSTRAPPED");
  }

  const salt = Uint8Array.from(atob(profile.kdfSalt.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
  const kek = deriveKEK(masterPassword, salt, profile.kdfParams);

  try {
    const rootKey = unwrapRootKey({ wrapped: profile.wrappedRootKey }, kek);
    zeroKey(kek);
    return rootKey;
  } catch {
    zeroKey(kek);
    throw new Error("Incorrect master password");
  }
}

export async function changeProfilePassword(
  profileId: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ recoveryKey: string }> {
  const rootKey = await unlockProfile(profileId, currentPassword);

  const newSalt = generateSalt();
  const newKek = deriveKEK(newPassword, newSalt, DEFAULT_KDF_PARAMS);
  const wrapped = wrapRootKey(rootKey, newKek);
  const { recoveryKey, wrappedRootKey: recoveryWrapped } = generateRecoveryKeyRaw(rootKey);

  try {
    await browserTrpcClient.profiles.changePassword.mutate({
      profileId,
      wrappedRootKey: wrapped.wrapped,
      kdfSalt: toBase64(newSalt),
      kdfParams: DEFAULT_KDF_PARAMS,
    });
  } catch (error) {
    zeroKey(newKek);
    zeroKey(rootKey);
    throw new Error(getClientErrorMessage(error, "Password change failed"));
  }

  try {
    await browserTrpcClient.profiles.setupRecovery.mutate({
      profileId,
      recoveryWrappedRootKey: recoveryWrapped.wrapped,
    });
  } catch {
    zeroKey(newKek);
    zeroKey(rootKey);
    // Password was changed successfully but recovery key update failed.
    // The user's new password is active — communicate this clearly.
    throw new Error(
      "Password changed successfully, but recovery key update failed. Your new password is active. Please try updating recovery from settings.",
    );
  }

  zeroKey(newKek);
  zeroKey(rootKey);
  return { recoveryKey };
}

export async function recoverProfile(
  profileId: string,
  recoveryKeyInput: string,
  newPassword: string,
): Promise<{ rootKey: Uint8Array; recoveryKey: string }> {
  let profile: { recoveryWrappedRootKey: string | null };

  try {
    const result = await browserTrpcClient.profiles.get.query({ profileId });
    profile = result.profile as { recoveryWrappedRootKey: string | null };
  } catch (error) {
    throw new Error(getClientErrorMessage(error, "Failed to fetch profile"));
  }

  if (!profile.recoveryWrappedRootKey) {
    throw new Error("No recovery key configured for this profile");
  }

  let rootKey: Uint8Array;
  try {
    rootKey = recoverRootKey(recoveryKeyInput, {
      wrapped: profile.recoveryWrappedRootKey,
    });
  } catch {
    throw new Error("Invalid recovery key");
  }

  const newSalt = generateSalt();
  const newKek = deriveKEK(newPassword, newSalt, DEFAULT_KDF_PARAMS);
  const wrapped = wrapRootKey(rootKey, newKek);
  const { recoveryKey, wrappedRootKey: recoveryWrapped } = generateRecoveryKeyRaw(rootKey);

  try {
    await browserTrpcClient.profiles.changePassword.mutate({
      profileId,
      wrappedRootKey: wrapped.wrapped,
      kdfSalt: toBase64(newSalt),
      kdfParams: DEFAULT_KDF_PARAMS,
    });
  } catch (error) {
    zeroKey(newKek);
    zeroKey(rootKey);
    throw new Error(getClientErrorMessage(error, "Password reset failed"));
  }

  try {
    await browserTrpcClient.profiles.setupRecovery.mutate({
      profileId,
      recoveryWrappedRootKey: recoveryWrapped.wrapped,
    });
  } catch {
    zeroKey(newKek);
    zeroKey(rootKey);
    throw new Error(
      "Password reset successfully, but recovery key update failed. Your new password is active. Please try updating recovery from settings.",
    );
  }

  zeroKey(newKek);
  return { rootKey, recoveryKey };
}

export function encryptItemForProfile(
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

export function decryptItemFromProfile(
  encryptedItemKey: string,
  ciphertext: string,
  rootKey: Uint8Array,
): ItemPayload {
  const decrypted = decryptItem({ encryptedItemKey, ciphertext }, rootKey);
  return deserializeItemPayload<ItemPayload>(decrypted);
}

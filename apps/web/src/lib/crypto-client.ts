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
import { clientEnv } from "@abadge/env/client";

const API_URL = clientEnv.NEXT_PUBLIC_API_URL;

export async function bootstrapVault(
  masterPassword: string,
): Promise<{ rootKey: Uint8Array; recoveryKey: string }> {
  const salt = generateSalt();
  const kek = deriveKEK(masterPassword, salt, DEFAULT_KDF_PARAMS);
  const rootKey = generateRootKey();
  const wrapped = wrapRootKey(rootKey, kek);
  const { recoveryKey, wrappedRootKey: recoveryWrapped } = generateRecoveryKeyRaw(rootKey);

  const res = await fetch(`${API_URL}/v1/vault/bootstrap`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      wrappedRootKey: wrapped.wrapped,
      kdfSalt: toBase64(salt),
      kdfParams: DEFAULT_KDF_PARAMS,
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Bootstrap failed" }));
    throw new Error((data as { error?: string }).error ?? "Bootstrap failed");
  }

  // Set up recovery key
  await fetch(`${API_URL}/v1/vault/recovery/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ recoveryWrappedRootKey: recoveryWrapped.wrapped }),
  });

  zeroKey(kek);
  return { rootKey, recoveryKey };
}

export async function unlockVault(masterPassword: string): Promise<Uint8Array> {
  const res = await fetch(`${API_URL}/v1/vault`, {
    credentials: "include",
  });

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error("VAULT_NOT_FOUND");
    }
    throw new Error("Failed to fetch vault");
  }

  const vault = (await res.json()) as {
    wrappedRootKey: string;
    kdfSalt: string;
    kdfParams: KDFParams;
  };

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

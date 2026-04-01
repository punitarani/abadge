/**
 * Client-side crypto for ZK vault operations.
 * Uses Web Crypto API with PBKDF2 (placeholder for Argon2id when @abadge/crypto ships).
 */

import { clientEnv } from "@abadge/env/client";

const API_URL = clientEnv.NEXT_PUBLIC_API_URL;

function toBase64(buf: Uint8Array): string {
  let binary = "";
  for (const byte of buf) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    buf[i] = binary.charCodeAt(i);
  }
  return buf;
}

function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

// PBKDF2 placeholder — swap for Argon2id when @abadge/crypto ships
async function deriveKEK(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

async function generateRootKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

async function wrapRootKey(
  rootKey: CryptoKey,
  kek: CryptoKey,
): Promise<{ wrappedKey: string; iv: string }> {
  const iv = randomBytes(12);
  const wrapped = await crypto.subtle.wrapKey("raw", rootKey, kek, { name: "AES-GCM", iv });
  return { wrappedKey: toBase64(new Uint8Array(wrapped)), iv: toBase64(iv) };
}

async function unwrapRootKey(wrappedKey: string, iv: string, kek: CryptoKey): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    "raw",
    fromBase64(wrappedKey),
    kek,
    { name: "AES-GCM", iv: fromBase64(iv) },
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

export interface EncryptedItem {
  encryptedItemKey: string;
  ciphertext: string;
  itemIv: string;
  keyIv: string;
}

export async function encryptItemForVault(
  payload: string,
  rootKey: CryptoKey,
): Promise<EncryptedItem> {
  const itemKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);

  const itemIvBytes = randomBytes(12);
  const enc = new TextEncoder();
  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: itemIvBytes },
    itemKey,
    enc.encode(payload),
  );

  const keyIvBytes = randomBytes(12);
  const wrappedItemKey = await crypto.subtle.wrapKey("raw", itemKey, rootKey, {
    name: "AES-GCM",
    iv: keyIvBytes,
  });

  return {
    encryptedItemKey: toBase64(new Uint8Array(wrappedItemKey)),
    ciphertext: toBase64(new Uint8Array(ciphertextBuf)),
    itemIv: toBase64(itemIvBytes),
    keyIv: toBase64(keyIvBytes),
  };
}

export async function decryptItemFromVault(
  encrypted: EncryptedItem,
  rootKey: CryptoKey,
): Promise<string> {
  const itemKey = await crypto.subtle.unwrapKey(
    "raw",
    fromBase64(encrypted.encryptedItemKey),
    rootKey,
    { name: "AES-GCM", iv: fromBase64(encrypted.keyIv) },
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );

  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(encrypted.itemIv) },
    itemKey,
    fromBase64(encrypted.ciphertext),
  );

  return new TextDecoder().decode(plainBuf);
}

function formatRecoveryKey(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/=+$/, "");
}

export interface VaultState {
  wrappedRootKey: string;
  rootKeyIv: string;
  salt: string;
}

export async function bootstrapVault(
  masterPassword: string,
): Promise<{ rootKey: CryptoKey; recoveryKey: string }> {
  const salt = randomBytes(32);
  const kek = await deriveKEK(masterPassword, salt);
  const rootKey = await generateRootKey();
  const { wrappedKey, iv } = await wrapRootKey(rootKey, kek);

  const recoveryBytes = randomBytes(32);
  const recoveryKek = await deriveKEK(formatRecoveryKey(recoveryBytes), salt);
  const recovery = await wrapRootKey(rootKey, recoveryKek);

  const res = await fetch(`${API_URL}/v1/vault/bootstrap`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      wrappedRootKey: wrappedKey,
      rootKeyIv: iv,
      salt: toBase64(salt),
      recoveryWrappedKey: recovery.wrappedKey,
      recoveryKeyIv: recovery.iv,
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Bootstrap failed" }));
    throw new Error((data as { error?: string }).error ?? "Bootstrap failed");
  }

  return { rootKey, recoveryKey: formatRecoveryKey(recoveryBytes) };
}

export async function unlockVault(masterPassword: string): Promise<CryptoKey> {
  const res = await fetch(`${API_URL}/v1/vault`, {
    credentials: "include",
  });

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error("VAULT_NOT_FOUND");
    }
    throw new Error("Failed to fetch vault");
  }

  const vault = (await res.json()) as VaultState;
  const salt = fromBase64(vault.salt);
  const kek = await deriveKEK(masterPassword, salt);

  try {
    return await unwrapRootKey(vault.wrappedRootKey, vault.rootKeyIv, kek);
  } catch {
    throw new Error("Incorrect master password");
  }
}

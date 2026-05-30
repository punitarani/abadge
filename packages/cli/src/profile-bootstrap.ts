import {
  DEFAULT_KDF_PARAMS,
  deriveKEK,
  generateRecoveryKey,
  generateRootKey,
  generateSalt,
  type KDFParams,
  toBase64,
  wrapRootKey,
  zeroKey,
} from "@abadge/crypto";

/**
 * A freshly-bootstrapped profile always starts at keyVersion 1. The root-wrap
 * AAD binds to `{profileId, keyVersion}`, and this MUST match what the daemon's
 * `vault.unlock` rebuilds when it later unwraps — otherwise the AEAD tag check
 * fails. Mirrors `apps/web/src/lib/crypto-client.ts::bootstrapProfile`, so a
 * profile bootstrapped via the CLI is unlockable exactly like a web-bootstrapped
 * one.
 */
export const INITIAL_PROFILE_KEY_VERSION = 1;

export interface BootstrapMaterial {
  /** base64 wrapped root key (password-derived KEK). */
  wrappedRootKey: string;
  /** base64 KDF salt. */
  kdfSalt: string;
  kdfParams: KDFParams;
  /** base64 root key wrapped under the recovery key. */
  recoveryWrappedRootKey: string;
  /** The human-readable recovery key — shown once, never recoverable. */
  recoveryKey: string;
}

/**
 * Compute all material needed to bootstrap a zero-knowledge profile from a
 * master password, client-side. The root key is generated locally, wrapped
 * under the Argon2id-derived KEK, and zeroed before returning — only wrapped
 * forms leave this function.
 */
export function computeBootstrapMaterial(
  profileId: string,
  masterPassword: string,
  // Overridable only so tests can use cheap Argon2id params; production always
  // uses DEFAULT_KDF_PARAMS. The chosen params are persisted with the profile,
  // and `vault.unlock` re-derives the KEK with the same params at unlock time.
  kdfParams: KDFParams = DEFAULT_KDF_PARAMS,
): BootstrapMaterial {
  const salt = generateSalt();
  const kek = deriveKEK(masterPassword, salt, kdfParams);
  const rootKey = generateRootKey();
  const meta = { profileId, keyVersion: INITIAL_PROFILE_KEY_VERSION };
  const wrapped = wrapRootKey(rootKey, kek, meta);
  const { recoveryKey, wrappedRootKey: recoveryWrapped } = generateRecoveryKey(rootKey, meta);

  zeroKey(kek);
  zeroKey(rootKey);

  return {
    wrappedRootKey: wrapped.wrapped,
    kdfSalt: toBase64(salt),
    kdfParams,
    recoveryWrappedRootKey: recoveryWrapped.wrapped,
    recoveryKey,
  };
}

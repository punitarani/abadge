/**
 * Shared profile-bootstrap helpers used by both the onboarding flow and the
 * ProfileCreateDrawer on the /profiles page.
 */

import {
  DEFAULT_KDF_PARAMS,
  deriveKEK,
  generateRootKey,
  generateSalt,
  toBase64,
  wrapRootKey,
  zeroKey,
} from "@abadge/crypto";
import { browserTrpcClient } from "@/lib/trpc-browser";

/**
 * Derives a KEK from the password, generates a root key, wraps it, and
 * bootstraps the profile via the API.
 *
 * The server never sees the plaintext password or root key — only the
 * wrapped root key and KDF parameters are transmitted.
 */
export async function bootstrapZkProfile(profileId: string, password: string): Promise<void> {
  const salt = generateSalt();
  const kek = deriveKEK(password, salt, DEFAULT_KDF_PARAMS);
  const rootKey = generateRootKey();
  const wrapped = wrapRootKey(rootKey, kek);

  try {
    await browserTrpcClient.profiles.bootstrap.mutate({
      profileId,
      wrappedRootKey: wrapped.wrapped,
      kdfSalt: toBase64(salt),
      kdfParams: DEFAULT_KDF_PARAMS,
    });
  } finally {
    zeroKey(kek);
    zeroKey(rootKey);
  }
}

// Re-export so callers can import both helpers from one place.
export { resolveOrCreateProfile } from "@/app/onboarding/resolve-profile";
export type { ProfileResolverClient, ResolveProfileInput } from "@/app/onboarding/resolve-profile";

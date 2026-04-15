import { createNodeTrpcClient, normalizeTrpcError } from "@abadge/trpc/client";
import type { VaultMeta } from "./types";

function createSessionClient(apiUrl: string, headers: Record<string, string>) {
  return createNodeTrpcClient({
    baseUrl: apiUrl,
    headers,
  });
}

/**
 * Fetch profile metadata from the API for the daemon's ZK operations.
 *
 * Returns null when the profile exists but has not been bootstrapped
 * (no wrappedRootKey/kdfSalt/kdfParams), or when it is missing entirely.
 * The caller treats both cases as "vault not found — bootstrap first".
 */
export async function fetchVaultMeta(
  apiUrl: string,
  headers: Record<string, string>,
  profileId: string,
): Promise<VaultMeta | null> {
  const client = createSessionClient(apiUrl, headers);

  try {
    const data = await client.profiles.get.query({ profileId });
    const profile = data.profile;
    if (!profile.wrappedRootKey || !profile.kdfSalt || !profile.kdfParams) {
      return null;
    }
    return {
      id: profile.id,
      wrappedRootKey: profile.wrappedRootKey,
      kdfSalt: profile.kdfSalt,
      kdfParams: profile.kdfParams as VaultMeta["kdfParams"],
      keyVersion: profile.keyVersion,
    };
  } catch (error) {
    const normalized = normalizeTrpcError(error);
    if (normalized.httpStatus === 404 || normalized.code === "PROFILE_NOT_FOUND") {
      return null;
    }
    throw new Error(normalized.message || "Failed to fetch profile metadata");
  }
}

/** Update wrapped root key on the API after password change. */
export async function updateVaultPassword(
  apiUrl: string,
  headers: Record<string, string>,
  profileId: string,
  body: { wrappedRootKey: string; kdfSalt: string; kdfParams: unknown },
): Promise<void> {
  const client = createSessionClient(apiUrl, headers);

  try {
    await client.profiles.changePassword.mutate({
      profileId,
      wrappedRootKey: body.wrappedRootKey,
      kdfSalt: body.kdfSalt,
      kdfParams: body.kdfParams as VaultMeta["kdfParams"],
    });
  } catch (error) {
    const normalized = normalizeTrpcError(error);
    throw new Error(normalized.message || "Failed to update profile password");
  }
}

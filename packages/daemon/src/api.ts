import { createNodeTrpcClient, normalizeTrpcError } from "@abadge/trpc/client";
import type { VaultMeta } from "./types";

/** Fetch vault metadata from the API. */
export async function fetchVaultMeta(apiUrl: string, authToken: string): Promise<VaultMeta | null> {
  const client = createNodeTrpcClient({
    baseUrl: apiUrl,
    token: authToken,
  });

  try {
    const data = await client.vault.get.query();
    return data.vault;
  } catch (error) {
    const normalized = normalizeTrpcError(error);
    if (normalized.httpStatus === 404 || normalized.appCode === "VAULT_NOT_FOUND") {
      return null;
    }
    throw new Error(normalized.message || "Failed to fetch vault metadata");
  }
}

/** Update wrapped root key on the API after password change. */
export async function updateVaultPassword(
  apiUrl: string,
  authToken: string,
  body: { wrappedRootKey: string; kdfSalt: string; kdfParams: unknown },
): Promise<void> {
  const client = createNodeTrpcClient({
    baseUrl: apiUrl,
    token: authToken,
  });

  try {
    await client.vault.changePassword.mutate({
      wrappedRootKey: body.wrappedRootKey,
      kdfSalt: body.kdfSalt,
      kdfParams: body.kdfParams as VaultMeta["kdfParams"],
    });
  } catch (error) {
    const normalized = normalizeTrpcError(error);
    throw new Error(normalized.message || "Failed to update vault password");
  }
}

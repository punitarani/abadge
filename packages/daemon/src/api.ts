import type { VaultMeta } from "./types";

/** Fetch vault metadata from the API. */
export async function fetchVaultMeta(apiUrl: string, authToken: string): Promise<VaultMeta | null> {
  const res = await fetch(`${apiUrl}/vault`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    throw new Error(`Failed to fetch vault metadata: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as VaultMeta;
  return data;
}

/** Update wrapped root key on the API after password change. */
export async function updateVaultPassword(
  apiUrl: string,
  authToken: string,
  body: { wrappedRootKey: string; kdfSalt: string; kdfParams: unknown },
): Promise<void> {
  const res = await fetch(`${apiUrl}/vault/change-password`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Failed to update vault password: ${res.status} ${res.statusText}`);
  }
}

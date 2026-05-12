import { payloadToSecret } from "@abadge/core";
import { type AbadgeAgentClient, AbadgeApiError } from "@abadge/sdk";
import { daemonDecrypt } from "./daemon";

async function decryptMountedPayload(
  encryptedItemKey: string,
  ciphertext: string,
  meta: { profileId: string; itemId: string; contentVersion: number },
  field?: string,
): Promise<string> {
  try {
    const result = await daemonDecrypt(encryptedItemKey, ciphertext, meta);
    return payloadToSecret(result.payload, field);
  } catch {
    throw new Error(
      "Zero-knowledge items require the local daemon for decryption.\n" +
        "hint: Start it with: abadge daemon start && abadge profile unlock\n" +
        "hint: Or use a server-managed profile for remote agent access.",
    );
  }
}

/**
 * §RM-PR4 — Resolve a single secret value through the redeemMount path. The
 * legacy `accessMount` codepath is preserved on `AbadgeAgentClient` for one
 * release; new CLI invocations route through `access.use` → `redeemMount` so
 * every mint records a `mount_reservations` row + `via=mount_redeem` audit
 * event uniformly with the `--all` / `--expand-env` flows. Plain `abadge run
 * --item` previously bypassed this — review C3.
 */
async function resolveMountedSecret(
  client: AbadgeAgentClient,
  itemId: string,
  mountType: "env" | "file",
  field?: string,
): Promise<string> {
  // Mint the handle; server enforces capability + records the reservation.
  const handle = await client.access.use({ itemId }, { delivery: mountType, field });
  if (!("mountId" in handle)) {
    // The single-item overload always returns a UseAccessResponse; this guard
    // satisfies the static type union and surfaces a version-skew bug if the
    // server ever returns a profile shape for an item target.
    throw new AbadgeApiError(
      500,
      "INTEGRITY_ERROR",
      "access.use returned a profile-shaped response for an item target",
      "This indicates a server/client version skew; report a bug.",
    );
  }
  // Atomically consume; stolen/expired handles fail here before any decrypt.
  const redeemed = await client.access.redeemMount(handle.mountId);
  if (redeemed.storageMode === "zero_knowledge") {
    return decryptMountedPayload(
      redeemed.encryptedItemKey,
      redeemed.ciphertext,
      {
        profileId: redeemed.profileId,
        itemId: redeemed.itemId,
        contentVersion: redeemed.contentVersion,
      },
      field,
    );
  }

  return payloadToSecret(redeemed.payload, field);
}

export async function resolveSecretValue(
  client: AbadgeAgentClient,
  itemId: string,
  mountType: "env" | "file",
  field?: string,
): Promise<string> {
  return resolveMountedSecret(client, itemId, mountType, field);
}

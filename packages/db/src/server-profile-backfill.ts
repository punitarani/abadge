import { serverDecrypt, serverEncrypt } from "@abadge/crypto/server";
import {
  profileIdForServerAad,
  SERVER_AAD_MIN_VERSION,
  type ServerAadMeta,
} from "@abadge/crypto/shared";

/**
 * §AB-0003 — backfill pre-fix server_managed items onto a real profile.
 *
 * Before §AB-0001, server_managed items were written with `profileId = NULL`,
 * so profile-level permission grants (which skip NULL-profile rows) never
 * covered them. This re-encrypts each unbound item under its org's default
 * profile and binds it. Pre-fix ciphertext comes in two formats — both decrypt
 * cleanly here and re-encrypt at v2 bound to the real profile:
 *   - v1 (`serverKeyVersion < SERVER_AAD_MIN_VERSION`): no AAD.
 *   - v2 (`>= SERVER_AAD_MIN_VERSION`, `profileId = NULL`): the no-profile AAD sentinel.
 *
 * The logic is a pure function over a {@link ServerItemProfileBackfillStore} so it
 * is unit-testable without a database; the runner wires Drizzle to the store.
 */

export interface UnboundServerItemRecord {
  id: string;
  serverCiphertext: string;
  serverIv: string;
  serverKeyVersion: number;
}

export interface BoundServerItem {
  id: string;
  profileId: string;
  serverCiphertext: string;
  serverIv: string;
  serverKeyVersion: number;
}

export interface ServerItemProfileBackfillStore {
  /** Org IDs with at least one bootstrapped profile (a binding target may exist). */
  listBootstrappedOrgIds(): Promise<string[]>;
  /** Default `server_managed` profile to bind unbound items to, or null if none. */
  defaultServerManagedProfileId(organizationId: string): Promise<string | null>;
  /** Non-deleted `server_managed` items in the org whose `profileId` is NULL. */
  listUnboundServerManagedItems(organizationId: string): Promise<UnboundServerItemRecord[]>;
  /** Persist a re-encrypted, profile-bound item. */
  bindServerManagedItem(item: BoundServerItem): Promise<void>;
}

export interface OrgBackfillCount {
  organizationId: string;
  profileId: string;
  migrated: number;
}

export interface ServerItemProfileBackfillResult {
  scanned: number;
  migrated: number;
  perOrg: OrgBackfillCount[];
}

export async function backfillServerManagedItemProfiles(input: {
  db: ServerItemProfileBackfillStore;
  encryptionKey: string;
}): Promise<ServerItemProfileBackfillResult> {
  const perOrg: OrgBackfillCount[] = [];
  let scanned = 0;
  let migrated = 0;

  for (const organizationId of await input.db.listBootstrappedOrgIds()) {
    const profileId = await input.db.defaultServerManagedProfileId(organizationId);
    // No server_managed target profile in this org — nothing to bind to; leave
    // the items untouched rather than guess a destination.
    if (!profileId) continue;

    const items = await input.db.listUnboundServerManagedItems(organizationId);
    if (items.length === 0) continue;
    scanned += items.length;

    for (const item of items) {
      // Decrypt under the AAD the row was written with (NULL profile → sentinel
      // for v2; no AAD for v1).
      const decryptAad: ServerAadMeta | undefined =
        item.serverKeyVersion >= SERVER_AAD_MIN_VERSION
          ? {
              orgId: organizationId,
              profileId: profileIdForServerAad(null),
              itemId: item.id,
              keyVersion: item.serverKeyVersion,
            }
          : undefined;

      const plaintext = await serverDecrypt(
        {
          ciphertext: item.serverCiphertext,
          iv: item.serverIv,
          keyVersion: item.serverKeyVersion,
        },
        input.encryptionKey,
        decryptAad,
      );

      // Re-encrypt at v2 bound to the real profile.
      const reAad: ServerAadMeta = {
        orgId: organizationId,
        profileId: profileIdForServerAad(profileId),
        itemId: item.id,
        keyVersion: SERVER_AAD_MIN_VERSION,
      };
      const encrypted = await serverEncrypt(
        plaintext,
        input.encryptionKey,
        SERVER_AAD_MIN_VERSION,
        reAad,
      );

      await input.db.bindServerManagedItem({
        id: item.id,
        profileId,
        serverCiphertext: encrypted.ciphertext,
        serverIv: encrypted.iv,
        serverKeyVersion: encrypted.keyVersion,
      });
    }

    migrated += items.length;
    perOrg.push({ organizationId, profileId, migrated: items.length });
  }

  return { scanned, migrated, perOrg };
}

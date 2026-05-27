import {
  generateServerDek,
  serverDecrypt,
  serverEncrypt,
  unwrapServerDek,
  wrapServerDek,
} from "@abadge/crypto/server";
import {
  profileIdForServerAad,
  SERVER_AAD_MIN_VERSION,
  type ServerAadMeta,
  toBase64,
} from "@abadge/crypto/shared";
import { and, type Database, eq, isNull, type Transaction } from "@abadge/db";
import { profiles } from "@abadge/db/schema";

/**
 * §AB-0030 — centralizes server-managed item encryption across its version
 * branches so every call site (items.create/update, access reveal/read,
 * pipeline) shares one implementation:
 *
 *   v1 — content under ENCRYPTION_KEY, no AAD (legacy).
 *   v2 — content under ENCRYPTION_KEY, AAD-bound (§AB-0001).
 *   v3 — content under a per-profile DEK (wrapped by ENCRYPTION_KEY), AAD-bound.
 *
 * New writes are v3. The decrypt path branches on the stored
 * `serverKeyVersion`, so existing v1/v2 rows keep decrypting unchanged.
 */

type Db = Database | Transaction;

/** Envelope version used for new server-managed writes. */
export const SERVER_ENVELOPE_VERSION = 3;

interface ServerCipherRow {
  id: string;
  profileId: string | null;
  // Nullable to match the items row type directly; callers guard upstream and
  // decryptServerEnvelope re-validates, so call sites need no narrowing casts.
  serverCiphertext: string | null;
  serverIv: string | null;
  serverKeyVersion: number | null;
}

function aadFor(
  orgId: string,
  item: { id: string; profileId: string | null; serverKeyVersion: number },
): ServerAadMeta | undefined {
  return item.serverKeyVersion >= SERVER_AAD_MIN_VERSION
    ? {
        orgId,
        profileId: profileIdForServerAad(item.profileId),
        itemId: item.id,
        keyVersion: item.serverKeyVersion,
      }
    : undefined;
}

async function loadWrappedDek(db: Db, profileId: string): Promise<string | null> {
  const [profile] = await db
    .select({ wrapped: profiles.serverWrappedDek })
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .limit(1);
  return profile?.wrapped ?? null;
}

/** Decrypt a server-managed row, resolving its content key from the version. */
export async function decryptServerEnvelope(
  db: Db,
  encryptionKey: string,
  orgId: string,
  item: ServerCipherRow,
): Promise<Uint8Array> {
  const { serverCiphertext, serverIv, serverKeyVersion } = item;
  if (serverCiphertext == null || serverIv == null || serverKeyVersion == null) {
    throw new Error(`server item ${item.id} is missing ciphertext/iv/keyVersion`);
  }
  let contentKey = encryptionKey;
  if (serverKeyVersion >= SERVER_ENVELOPE_VERSION && item.profileId) {
    const wrapped = await loadWrappedDek(db, item.profileId);
    if (!wrapped) {
      throw new Error(`v3 server item ${item.id} references profile with no wrapped DEK`);
    }
    contentKey = toBase64(await unwrapServerDek(encryptionKey, wrapped));
  }
  return serverDecrypt(
    { ciphertext: serverCiphertext, iv: serverIv, keyVersion: serverKeyVersion },
    contentKey,
    aadFor(orgId, { id: item.id, profileId: item.profileId, serverKeyVersion }),
  );
}

/** Provision a profile's server DEK on first use (race-safe) and return it base64. */
async function ensureProfileDek(db: Db, encryptionKey: string, profileId: string): Promise<string> {
  const existing = await loadWrappedDek(db, profileId);
  if (existing) {
    return toBase64(await unwrapServerDek(encryptionKey, existing));
  }
  const wrapped = await wrapServerDek(encryptionKey, generateServerDek());
  // Only the first writer wins (WHERE … IS NULL); re-read to adopt the winner's DEK.
  await db
    .update(profiles)
    .set({ serverWrappedDek: wrapped })
    .where(and(eq(profiles.id, profileId), isNull(profiles.serverWrappedDek)));
  const current = await loadWrappedDek(db, profileId);
  if (!current) {
    throw new Error(`failed to provision server DEK for profile ${profileId}`);
  }
  return toBase64(await unwrapServerDek(encryptionKey, current));
}

/**
 * Encrypt a server-managed payload.
 *
 * With a `profileId` (always the case for new items, which resolve a default
 * profile): v3 under the profile's DEK, provisioned on first use. Without one
 * (a legacy NULL-profile row being updated before AB-0003 backfill binds it):
 * fall back to v2 under the master key with the no-profile sentinel AAD, so the
 * row stays decryptable without forcing a profile it doesn't have.
 */
export async function encryptServerEnvelope(
  db: Db,
  encryptionKey: string,
  orgId: string,
  profileId: string | null,
  itemId: string,
  plaintext: Uint8Array,
): Promise<{ ciphertext: string; iv: string; keyVersion: number }> {
  const keyVersion = profileId ? SERVER_ENVELOPE_VERSION : SERVER_AAD_MIN_VERSION;
  const contentKey = profileId
    ? await ensureProfileDek(db, encryptionKey, profileId)
    : encryptionKey;
  const aad: ServerAadMeta = {
    orgId,
    profileId: profileIdForServerAad(profileId),
    itemId,
    keyVersion,
  };
  return serverEncrypt(plaintext, contentKey, keyVersion, aad);
}

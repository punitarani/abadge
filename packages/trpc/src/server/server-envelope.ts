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
import { and, type Database, eq, isNull, sql, type Transaction } from "@abadge/db";
import { profiles } from "@abadge/db/schema";

/**
 * Centralizes server-managed item encryption across its version branches so
 * every call site (items.create/update, access reveal/read, pipeline) shares
 * one implementation:
 *
 *   v1 — content under ENCRYPTION_KEY, no AAD (legacy).
 *   v2 — content under ENCRYPTION_KEY, AAD-bound.
 *   v3 — content under a per-profile DEK (itself wrapped by ENCRYPTION_KEY,
 *        the wrap bound to (orgId, profileId)), AAD-bound.
 *   v4 — v3 + a key-commitment tag prefixed to the ciphertext.
 *
 * New writes are v4. The decrypt path branches on the stored `serverKeyVersion`,
 * so existing v1/v2/v3 rows keep decrypting unchanged.
 */

type Db = Database | Transaction;

/** Minimum version whose content is encrypted under a per-profile DEK (v3 and v4). */
export const SERVER_DEK_MIN_VERSION = 3;

/** Envelope version for new server-managed writes (v4 = per-profile DEK + AAD + key commitment). */
export const SERVER_ENVELOPE_VERSION = 4;

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

/**
 * Unwrap a profile's server DEK into the base64 content key used to decrypt its
 * per-profile (v3/v4) items. Bulk callers scoped to a single profile resolve this
 * once and pass it to {@link decryptServerEnvelope} to avoid re-reading the DEK per item.
 */
export async function loadProfileContentKey(
  db: Db,
  encryptionKey: string,
  orgId: string,
  profileId: string,
): Promise<string> {
  const wrapped = await loadWrappedDek(db, profileId);
  if (!wrapped) {
    throw new Error(`server decrypt: profile ${profileId} has no wrapped DEK`);
  }
  return toBase64(await unwrapServerDek(encryptionKey, wrapped, { orgId, profileId }));
}

/**
 * Decrypt a server-managed row, resolving its content key from the version.
 * For v3/v4 rows, `cachedContentKey` (from {@link loadProfileContentKey}) may be
 * supplied to reuse an already-unwrapped DEK; it MUST belong to `item.profileId`.
 */
export async function decryptServerEnvelope(
  db: Db,
  encryptionKey: string,
  orgId: string,
  item: ServerCipherRow,
  cachedContentKey?: string,
): Promise<Uint8Array> {
  const { serverCiphertext, serverIv, serverKeyVersion } = item;
  if (serverCiphertext == null || serverIv == null || serverKeyVersion == null) {
    throw new Error(`server item ${item.id} is missing ciphertext/iv/keyVersion`);
  }
  let contentKey = encryptionKey;
  if (serverKeyVersion >= SERVER_DEK_MIN_VERSION) {
    if (!item.profileId) {
      throw new Error(`server item ${item.id} has keyVersion=${serverKeyVersion} but no profileId`);
    }
    contentKey =
      cachedContentKey ?? (await loadProfileContentKey(db, encryptionKey, orgId, item.profileId));
  }
  return serverDecrypt(
    { ciphertext: serverCiphertext, iv: serverIv, keyVersion: serverKeyVersion },
    contentKey,
    aadFor(orgId, { id: item.id, profileId: item.profileId, serverKeyVersion }),
  );
}

/** Provision a profile's server DEK on first use (race-safe) and return it base64. */
async function ensureProfileDek(
  db: Db,
  encryptionKey: string,
  orgId: string,
  profileId: string,
): Promise<string> {
  const existing = await loadWrappedDek(db, profileId);
  if (existing) {
    return toBase64(await unwrapServerDek(encryptionKey, existing, { orgId, profileId }));
  }
  const wrapped = await wrapServerDek(encryptionKey, generateServerDek(), { orgId, profileId });
  // Only the first writer wins (WHERE … IS NULL); re-read to adopt the winner's DEK.
  await db
    .update(profiles)
    .set({ serverWrappedDek: wrapped })
    .where(and(eq(profiles.id, profileId), isNull(profiles.serverWrappedDek)));
  const current = await loadWrappedDek(db, profileId);
  if (!current) {
    throw new Error(`failed to provision server DEK for profile ${profileId}`);
  }
  return toBase64(await unwrapServerDek(encryptionKey, current, { orgId, profileId }));
}

/**
 * Encrypt a server-managed payload.
 *
 * With a `profileId` (always the case for new items, which resolve a default
 * profile): v4 (per-profile DEK + key commitment) under the profile's DEK,
 * provisioned on first use. Without one
 * (a legacy NULL-profile row being updated before its profile is backfilled):
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
    ? await ensureProfileDek(db, encryptionKey, orgId, profileId)
    : encryptionKey;
  const aad: ServerAadMeta = {
    orgId,
    profileId: profileIdForServerAad(profileId),
    itemId,
    keyVersion,
  };
  const result = await serverEncrypt(plaintext, contentKey, keyVersion, aad);

  // Track this profile's AES-GCM encryption count against the per-profile-DEK
  // nonce budget. Only v3+ (per-profile DEK) writes are counted here; v1/v2
  // NULL-profile rows encrypt under the master ENCRYPTION_KEY, whose (separate,
  // shared) budget this per-profile counter intentionally does not track — see
  // docs/SECURITY.md.
  //
  // Awaited (not fire-and-forget): an un-awaited update on a `db` that is a
  // transaction can execute after the tx closes and be lost, silently
  // under-counting — the dangerous direction for a budget. Awaiting makes the
  // increment join the caller's transaction when one is passed (committing or
  // rolling back atomically with the write) and otherwise biases to over-count.
  // The count is advisory (warn-only), so a failure must not block the write,
  // but it is logged rather than swallowed so under-counts are visible.
  if (profileId) {
    try {
      const [row] = await db
        .update(profiles)
        .set({ serverEncryptionCount: sql`${profiles.serverEncryptionCount} + 1` })
        .where(eq(profiles.id, profileId))
        .returning({ count: profiles.serverEncryptionCount });
      if (row && row.count >= 134_217_728) {
        console.warn(
          `[abadge] profile ${profileId} server_encryption_count=${row.count} approaching the per-key AES-GCM nonce budget (warn at 2^27, rotate by 2^28) — rotate the profile DEK and reset the counter (docs/runbooks/key-rotation.md §B)`,
        );
      }
    } catch (err) {
      console.error(
        `[abadge] failed to increment server_encryption_count for profile ${profileId}`,
        err,
      );
    }
  }

  return result;
}

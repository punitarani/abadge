/**
 * AAD (additionalData) construction for AES-GCM server-managed items.
 *
 * Server-managed items share a single global ENCRYPTION_KEY. Without AAD
 * binding, a DB-write-capable adversary could swap (server_ciphertext,
 * server_iv) between any two server-managed items — even across
 * organizations — and AES-GCM decrypt would succeed silently, returning
 * the wrong item's plaintext.
 *
 * `buildServerAad` binds each ciphertext to its logical identity
 * (org, profile, item, keyVersion). Any substitution after encrypt will
 * cause AES-GCM tag verification to reject the ciphertext on decrypt.
 *
 * Wire format:
 *   "abadge-sm-v1\0" || orgId \0 || profileId \0 || itemId \0 || u32be(keyVersion)
 *
 * Notes:
 * - Null byte separators prevent boundary-ambiguity attacks
 *   (abc|def|ghi vs abcd|ef|ghi would otherwise collide).
 * - The "abadge-sm-v1" domain-separation prefix reserves this AAD
 *   namespace; future variants (ZK wrap, root-key wrap) get distinct
 *   prefixes so AAD values never collide between subsystems.
 * - keyVersion is encoded big-endian for byte-order determinism.
 */

export interface ServerAadMeta {
  orgId: string;
  /**
   * Profile the item belongs to. Pass `NO_PROFILE_AAD_SENTINEL` when the
   * item has no profile assigned (legacy server-managed items may have
   * `profileId === null`). Using a sentinel keeps the AAD well-defined
   * and constant-width for the "no profile" case.
   */
  profileId: string;
  itemId: string;
  /**
   * `serverKeyVersion` column value. Doubles as the AAD-epoch marker:
   *   `1` → legacy ciphertext without AAD (must NOT be passed here).
   *   `>= 2` → AAD-bound ciphertext produced by `buildServerAad`.
   */
  keyVersion: number;
}

/**
 * Sentinel substituted into the AAD when a server-managed item has no
 * profile (legacy items predate the requirement). Keep this value stable
 * and identical on both encrypt and decrypt; changing it would strand
 * the corresponding ciphertext.
 */
export const NO_PROFILE_AAD_SENTINEL = "__no_profile__";

/**
 * First `serverKeyVersion` that carries AAD. Rows with
 * `serverKeyVersion < SERVER_AAD_MIN_VERSION` are legacy v1 ciphertext
 * and MUST be decrypted without AAD.
 */
export const SERVER_AAD_MIN_VERSION = 2;

/**
 * Canonical `profileId` component for server-managed AAD.
 * Encrypt and decrypt sites MUST both use this helper so that a future
 * change to the fallback (e.g. when server-managed items gain a
 * required profile) is applied symmetrically in one place. A mismatch
 * here would silently prevent decrypt of already-stored ciphertext.
 */
export function profileIdForServerAad(profileId: string | null | undefined): string {
  return profileId ?? NO_PROFILE_AAD_SENTINEL;
}

export function buildServerAad(meta: ServerAadMeta): Uint8Array {
  const enc = new TextEncoder();
  const prefix = enc.encode("abadge-sm-v1\0");
  const orgBytes = enc.encode(`${meta.orgId}\0`);
  const profileBytes = enc.encode(`${meta.profileId}\0`);
  const itemBytes = enc.encode(`${meta.itemId}\0`);

  const kv = new Uint8Array(4);
  new DataView(kv.buffer).setUint32(0, meta.keyVersion, false);

  const total =
    prefix.length + orgBytes.length + profileBytes.length + itemBytes.length + kv.length;
  const out = new Uint8Array(total);
  let offset = 0;
  out.set(prefix, offset);
  offset += prefix.length;
  out.set(orgBytes, offset);
  offset += orgBytes.length;
  out.set(profileBytes, offset);
  offset += profileBytes.length;
  out.set(itemBytes, offset);
  offset += itemBytes.length;
  out.set(kv, offset);

  return out;
}

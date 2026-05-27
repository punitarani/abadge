/**
 * AAD (additionalData) construction for AES-GCM and XChaCha20-Poly1305.
 *
 * Server-managed items share a single global ENCRYPTION_KEY. Zero-knowledge
 * items share a per-profile root key. Without AAD binding, a DB-write-capable
 * adversary could swap ciphertext rows between items and AEAD decrypt would
 * succeed silently, returning the wrong item's plaintext.
 *
 * Each AEAD call site binds its ciphertext to the smallest logical identity
 * that uniquely names it, using a distinct domain-separation prefix so AAD
 * values never collide between subsystems:
 *
 *   AES-GCM (server-managed content) → `buildServerAad`       ("abadge-sm-v1")
 *   ZK content cipher                → `buildZkContentAad`    ("abadge-zk-content-v1")
 *   ZK DEK-wrap cipher               → `buildZkDekWrapAad`    ("abadge-zk-dek-v1")
 *   ZK root-key wrap cipher          → `buildZkRootWrapAad`   ("abadge-zk-root-v1")
 *
 * Notes:
 * - Null byte separators prevent boundary-ambiguity attacks
 *   ("ab"|"cd" vs "a"|"bcd" would otherwise collide).
 * - Integer fields are encoded big-endian for byte-order determinism.
 */

// -----------------------------------------------------------------------------
// Shared encoding helpers
// -----------------------------------------------------------------------------

function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function u32be(n: number): Uint8Array {
  const a = new Uint8Array(4);
  new DataView(a.buffer).setUint32(0, n, false);
  return a;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

// -----------------------------------------------------------------------------
// Server-managed (AES-GCM) AAD
// -----------------------------------------------------------------------------

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
  return concat([
    encode("abadge-sm-v1\0"),
    encode(`${meta.orgId}\0`),
    encode(`${meta.profileId}\0`),
    encode(`${meta.itemId}\0`),
    u32be(meta.keyVersion),
  ]);
}

export interface ServerDekWrapAadMeta {
  orgId: string;
  profileId: string;
}

/**
 * AAD for the server-managed per-profile DEK wrap (`profiles.server_wrapped_dek`).
 * Binds the wrapped DEK to (org, profile) so a wrapped DEK transplanted to
 * another profile fails to unwrap. Mirrors `buildZkDekWrapAad` on the ZK side.
 *
 * Wire format:
 *   "abadge-sm-dek-v1\0" || orgId \0 || profileId \0
 */
export function buildServerDekWrapAad(meta: ServerDekWrapAadMeta): Uint8Array {
  return concat([
    encode("abadge-sm-dek-v1\0"),
    encode(`${meta.orgId}\0`),
    encode(`${meta.profileId}\0`),
  ]);
}

// -----------------------------------------------------------------------------
// Zero-knowledge (XChaCha20-Poly1305) AAD — W1S7-001
// -----------------------------------------------------------------------------

export interface ZkContentAadMeta {
  profileId: string;
  itemId: string;
  contentVersion: number;
}

export interface ZkDekWrapAadMeta {
  profileId: string;
  itemId: string;
}

export interface ZkRootWrapAadMeta {
  profileId: string;
  keyVersion: number;
}

/**
 * AAD for ZK item content (payload ciphertext). Binds to
 * profile × item × contentVersion so a DB-row swap of ciphertext between
 * items — or a rollback to a stale `contentVersion` — is detected on decrypt.
 *
 * Wire format:
 *   "abadge-zk-content-v1\0" || profileId \0 || itemId \0 || u32be(contentVersion)
 */
export function buildZkContentAad(meta: ZkContentAadMeta): Uint8Array {
  return concat([
    encode("abadge-zk-content-v1\0"),
    encode(`${meta.profileId}\0`),
    encode(`${meta.itemId}\0`),
    u32be(meta.contentVersion),
  ]);
}

/**
 * AAD for ZK item DEK wrap (encryptedItemKey). Binds to profile × item so a
 * DEK-wrap swap between items within the same profile is detected.
 *
 * No `contentVersion` field: the DEK-wrap is rewritten alongside the content
 * ciphertext on every item update (both `encryptedItemKey` and `ciphertext`
 * columns are repopulated in the ZK update branch). Binding the DEK-wrap to
 * `contentVersion` would therefore duplicate the content-AAD check with no
 * additional coverage; binding to (profile, item) alone is sufficient to
 * prevent cross-item DEK-wrap substitution.
 *
 * Wire format:
 *   "abadge-zk-dek-v1\0" || profileId \0 || itemId \0
 */
export function buildZkDekWrapAad(meta: ZkDekWrapAadMeta): Uint8Array {
  return concat([
    encode("abadge-zk-dek-v1\0"),
    encode(`${meta.profileId}\0`),
    encode(`${meta.itemId}\0`),
  ]);
}

/**
 * AAD for ZK root-key wrap (`profiles.wrappedRootKey` and
 * `profiles.recoveryWrappedRootKey`). Binds to profile × keyVersion so a
 * profile's wrapped root key can't be swapped with another profile's
 * wrapped root key, and so a stale pre-rotation root-key wrap cannot be
 * replayed onto a profile that has since advanced its `keyVersion`.
 *
 * Wire format:
 *   "abadge-zk-root-v1\0" || profileId \0 || u32be(keyVersion)
 */
export function buildZkRootWrapAad(meta: ZkRootWrapAadMeta): Uint8Array {
  return concat([
    encode("abadge-zk-root-v1\0"),
    encode(`${meta.profileId}\0`),
    u32be(meta.keyVersion),
  ]);
}

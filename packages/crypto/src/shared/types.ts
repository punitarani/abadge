/** Argon2id KDF parameters stored alongside the wrapped root key. */
export interface KDFParams {
  algorithm: "argon2id";
  /** Memory in KiB (default 65536 = 64 MiB) */
  memory: number;
  /** Number of iterations (default 3) */
  iterations: number;
  /** Degree of parallelism (default 1) */
  parallelism: number;
  /** Output hash length in bytes (default 32) */
  hashLength: number;
}

/** A key wrapped with XChaCha20-Poly1305. Nonce is prepended to ciphertext. */
export interface WrappedKey {
  /** base64url: nonce (24 bytes) || ciphertext + auth tag */
  wrapped: string;
}

/** An encrypted item (ZK mode). */
export interface EncryptedItem {
  /** base64url: nonce (24 bytes) || DEK encrypted by root key */
  encryptedItemKey: string;
  /** base64url: nonce (24 bytes) || payload encrypted by DEK */
  ciphertext: string;
}

/** An encrypted item (server-managed mode). */
export interface ServerEncryptedItem {
  /** base64url: AES-GCM ciphertext */
  ciphertext: string;
  /** base64url: 12-byte IV */
  iv: string;
  /** Server master key version used */
  keyVersion: number;
}

/** Result of generating an API key. */
export interface GeneratedApiKey {
  /** Full key (show once, never store) */
  key: string;
  /** SHA-256 hash of full key (store this) */
  hash: string;
  /** First 8 chars for lookup */
  prefix: string;
}

/** Default KDF parameters per RFC 9106 second recommendation. */
export const DEFAULT_KDF_PARAMS: KDFParams = {
  algorithm: "argon2id",
  memory: 65536,
  iterations: 3,
  parallelism: 1,
  hashLength: 32,
};

/** Envelope version for current crypto format. */
export const CRYPTO_VERSION = 1;

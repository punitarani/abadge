// Client-side crypto (@noble/ciphers, @noble/hashes) — for browser, CLI, daemon
export {
  deriveKEK,
  generateRootKey,
  wrapRootKey,
  unwrapRootKey,
  generateRecoveryKey,
  recoverRootKey,
  zeroKey,
  encryptItem,
  decryptItem,
  rekeyItem,
  serializeItemPayload,
  deserializeItemPayload,
} from "./client/index.js";

// Server-side crypto (AES-GCM via WebCrypto) — for API worker
export { serverEncrypt, serverDecrypt } from "./server/index.js";

// Shared utilities — safe for all environments
export {
  toBase64,
  fromBase64,
  toBase32,
  fromBase32,
  randomBytes,
  generateSalt,
  formatRecoveryKey,
  generateApiKey,
  hashApiKey,
  verifyApiKey,
} from "./shared/index.js";

// Types
export type {
  KDFParams,
  WrappedKey,
  EncryptedItem,
  ServerEncryptedItem,
  GeneratedApiKey,
} from "./shared/index.js";

export { DEFAULT_KDF_PARAMS, CRYPTO_VERSION } from "./shared/index.js";

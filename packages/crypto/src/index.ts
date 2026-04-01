// Client-side crypto (@noble/ciphers, @noble/hashes) — for browser, CLI, daemon
export {
  decryptItem,
  deriveKEK,
  deserializeItemPayload,
  encryptItem,
  generateRecoveryKey,
  generateRootKey,
  recoverRootKey,
  rekeyItem,
  serializeItemPayload,
  unwrapRootKey,
  wrapRootKey,
  zeroKey,
} from "./client/index";

// Server-side crypto (AES-GCM via WebCrypto) — for API worker
export { serverDecrypt, serverEncrypt } from "./server/index";
// Types
export type {
  EncryptedItem,
  GeneratedApiKey,
  KDFParams,
  ServerEncryptedItem,
  WrappedKey,
} from "./shared/index";
// Shared utilities — safe for all environments
export {
  CRYPTO_VERSION,
  DEFAULT_KDF_PARAMS,
  formatRecoveryKey,
  fromBase32,
  fromBase64,
  generateApiKey,
  generateSalt,
  hashApiKey,
  randomBytes,
  toBase32,
  toBase64,
  verifyApiKey,
} from "./shared/index";

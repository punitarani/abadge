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
export {
  generateServerDek,
  serverDecrypt,
  serverEncrypt,
  unwrapServerDek,
  wrapServerDek,
} from "./server/index";
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
  buildServerAad,
  buildServerDekWrapAad,
  buildZkContentAad,
  buildZkDekWrapAad,
  buildZkRootWrapAad,
  CRYPTO_VERSION,
  DEFAULT_KDF_PARAMS,
  formatRecoveryKey,
  fromBase32,
  fromBase64,
  generateApiKey,
  generateEd25519KeyPair,
  generateOpaqueToken,
  generateSalt,
  hashApiKey,
  NO_PROFILE_AAD_SENTINEL,
  normalizeEd25519PublicKeyJwk,
  profileIdForServerAad,
  randomBytes,
  SERVER_AAD_MIN_VERSION,
  type ServerAadMeta,
  type ServerDekWrapAadMeta,
  signEd25519,
  toBase32,
  toBase64,
  verifyApiKey,
  verifyEd25519,
  type ZkContentAadMeta,
  type ZkDekWrapAadMeta,
  type ZkRootWrapAadMeta,
} from "./shared/index";

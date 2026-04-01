export {
  toBase64,
  fromBase64,
  toBase32,
  fromBase32,
  randomBytes,
  generateSalt,
  formatRecoveryKey,
} from "./encoding.js";

export { generateApiKey, hashApiKey, verifyApiKey } from "./api-keys.js";

export type {
  KDFParams,
  WrappedKey,
  EncryptedItem,
  ServerEncryptedItem,
  GeneratedApiKey,
} from "./types.js";

export { DEFAULT_KDF_PARAMS, CRYPTO_VERSION } from "./types.js";

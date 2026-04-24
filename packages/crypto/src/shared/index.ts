export {
  buildServerAad,
  buildZkContentAad,
  buildZkDekWrapAad,
  buildZkRootWrapAad,
  NO_PROFILE_AAD_SENTINEL,
  profileIdForServerAad,
  SERVER_AAD_MIN_VERSION,
  type ServerAadMeta,
  type ZkContentAadMeta,
  type ZkDekWrapAadMeta,
  type ZkRootWrapAadMeta,
} from "./aad";
export { generateApiKey, hashApiKey, verifyApiKey } from "./api-keys";
export { generateEd25519KeyPair, generateOpaqueToken, signEd25519, verifyEd25519 } from "./ed25519";
export {
  formatRecoveryKey,
  fromBase32,
  fromBase64,
  generateSalt,
  randomBytes,
  toBase32,
  toBase64,
} from "./encoding";

export type {
  EncryptedItem,
  GeneratedApiKey,
  KDFParams,
  ServerEncryptedItem,
  WrappedKey,
} from "./types";

export { CRYPTO_VERSION, DEFAULT_KDF_PARAMS } from "./types";

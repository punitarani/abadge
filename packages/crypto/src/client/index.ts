export { deriveKEK } from "./kdf.js";

export {
  generateRootKey,
  wrapRootKey,
  unwrapRootKey,
  generateRecoveryKey,
  recoverRootKey,
  zeroKey,
} from "./keys.js";

export {
  encryptItem,
  decryptItem,
  rekeyItem,
  serializeItemPayload,
  deserializeItemPayload,
} from "./items.js";

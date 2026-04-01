import { argon2id } from "@noble/hashes/argon2";
import type { KDFParams } from "../shared/types";
import { DEFAULT_KDF_PARAMS } from "../shared/types";

/**
 * Derive a Key Encryption Key (KEK) from a master password using Argon2id.
 * This runs client-side only (browser, CLI, daemon). Never on the server.
 */
export function deriveKEK(
  password: string,
  salt: Uint8Array,
  params: KDFParams = DEFAULT_KDF_PARAMS,
): Uint8Array {
  const encoded = new TextEncoder().encode(password);
  return argon2id(encoded, salt, {
    t: params.iterations,
    m: params.memory,
    p: params.parallelism,
    dkLen: params.hashLength,
  });
}

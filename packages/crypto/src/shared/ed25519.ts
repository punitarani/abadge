import { fromBase64, randomBytes, toBase64 } from "./encoding";

function textToBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function toBufferSource(bytes: Uint8Array): ArrayBuffer {
  const cloned = new Uint8Array(bytes.length);
  cloned.set(bytes);
  return cloned.buffer;
}

function parseJwk(serialized: string): unknown {
  return JSON.parse(serialized);
}

/**
 * Validate and canonicalize an Ed25519 PUBLIC key JWK, returning the minimal
 * `{kty, crv, x}` form and dropping every other member.
 *
 * Critically this strips a non-standard `alg`: some WebCrypto implementations
 * stamp `alg:"Ed25519"` onto exported Ed25519 JWKs (the JWA value should be
 * "EdDSA"). Workers' `importKey()` rejects that unexpected `alg`, so an
 * un-normalized key would store fine yet make every later signature
 * verification throw. Canonicalizing at registration AND inside
 * `importPublicKey` keeps stored keys importable everywhere.
 *
 * Throws on anything that is not a well-formed Ed25519 public JWK.
 */
export function normalizeEd25519PublicKeyJwk(serialized: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("public key must be a JSON-encoded JWK");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("public key JWK must be a JSON object");
  }
  const jwk = parsed as Record<string, unknown>;
  if (jwk.kty !== "OKP") throw new Error('public key JWK must have kty:"OKP"');
  if (jwk.crv !== "Ed25519") throw new Error('public key JWK must have crv:"Ed25519"');
  if (typeof jwk.x !== "string" || jwk.x.length === 0) {
    throw new Error("public key JWK must include a base64url x coordinate");
  }
  if ("d" in jwk) throw new Error("public key JWK must not include a private component (d)");
  // Canonical public JWK only — no alg / key_ops / ext / use.
  return JSON.stringify({ kty: "OKP", crv: "Ed25519", x: jwk.x });
}

async function importPrivateKey(serialized: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", parseJwk(serialized) as never, { name: "Ed25519" }, false, [
    "sign",
  ]);
}

async function importPublicKey(serialized: string): Promise<CryptoKey> {
  // Canonicalize first: drops a non-standard `alg` (and other extras) that would
  // otherwise make importKey throw on JWKs exported by Node's WebCrypto.
  const canonical = normalizeEd25519PublicKeyJwk(serialized);
  return crypto.subtle.importKey("jwk", parseJwk(canonical) as never, { name: "Ed25519" }, false, [
    "verify",
  ]);
}

export async function generateEd25519KeyPair(): Promise<{
  publicKey: string;
  privateKey: string;
}> {
  const keyPair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as unknown as CryptoKeyPair;
  const publicKey = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const privateKey = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

  return {
    publicKey: JSON.stringify(publicKey),
    privateKey: JSON.stringify(privateKey),
  };
}

export async function signEd25519(privateKey: string, message: string): Promise<string> {
  const key = await importPrivateKey(privateKey);
  const signature = await crypto.subtle.sign("Ed25519", key, toBufferSource(textToBytes(message)));
  return toBase64(new Uint8Array(signature));
}

export async function verifyEd25519(
  publicKey: string,
  message: string,
  signature: string,
): Promise<boolean> {
  // Fail closed: a malformed/unsupported stored key or signature is an
  // authentication failure (caller maps `false` → 401), never an uncaught
  // error. importKey and verify are both wrapped so neither can throw out.
  let key: CryptoKey;
  try {
    key = await importPublicKey(publicKey);
  } catch {
    return false;
  }
  try {
    return await crypto.subtle.verify(
      "Ed25519",
      key,
      toBufferSource(fromBase64(signature)),
      toBufferSource(textToBytes(message)),
    );
  } catch {
    return false;
  }
}

export function generateOpaqueToken(prefix: string): string {
  return `${prefix}${toBase64(randomBytes(32))}`;
}

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

async function importPrivateKey(serialized: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", parseJwk(serialized) as never, { name: "Ed25519" }, false, [
    "sign",
  ]);
}

async function importPublicKey(serialized: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", parseJwk(serialized) as never, { name: "Ed25519" }, false, [
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
  const key = await importPublicKey(publicKey);
  return crypto.subtle.verify(
    "Ed25519",
    key,
    toBufferSource(fromBase64(signature)),
    toBufferSource(textToBytes(message)),
  );
}

export function generateOpaqueToken(prefix: string): string {
  return `${prefix}${toBase64(randomBytes(32))}`;
}

import { describe, expect, test } from "bun:test";
import {
  generateEd25519KeyPair,
  normalizeEd25519PublicKeyJwk,
  signEd25519,
  verifyEd25519,
} from "../shared/ed25519";

/** Simulate Node's WebCrypto, which stamps a non-standard `alg` on Ed25519 JWKs. */
function withExtra(jwk: string, extra: Record<string, unknown>): string {
  return JSON.stringify({ ...JSON.parse(jwk), ...extra });
}

describe("ed25519 public key canonicalization", () => {
  test("verifyEd25519 accepts a public JWK carrying a non-standard alg:Ed25519 (Node WebCrypto)", async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    const message = "abc_challenge_value";
    const signature = await signEd25519(privateKey, message);
    // Node's crypto.subtle.exportKey stamps alg:"Ed25519" (should be "EdDSA").
    // Before the fix, importKey() rejected this → verifyEd25519 threw → uncaught 500.
    const nodeStylePublic = withExtra(publicKey, {
      alg: "Ed25519",
      ext: true,
      key_ops: ["verify"],
    });
    await expect(verifyEd25519(nodeStylePublic, message, signature)).resolves.toBe(true);
  });

  test("verifyEd25519 returns false (never throws) on a malformed stored key", async () => {
    await expect(verifyEd25519("{not-json", "m", "c2ln")).resolves.toBe(false);
    await expect(verifyEd25519(JSON.stringify({ kty: "RSA" }), "m", "c2ln")).resolves.toBe(false);
  });

  test("verifyEd25519 still rejects a bad signature", async () => {
    const { publicKey } = await generateEd25519KeyPair();
    const { privateKey: otherPriv } = await generateEd25519KeyPair();
    const forged = await signEd25519(otherPriv, "msg");
    await expect(verifyEd25519(publicKey, "msg", forged)).resolves.toBe(false);
  });

  test("normalizeEd25519PublicKeyJwk strips alg + extras to the canonical {kty,crv,x}", async () => {
    const { publicKey } = await generateEd25519KeyPair();
    const { x } = JSON.parse(publicKey) as { x: string };
    const canonical = normalizeEd25519PublicKeyJwk(
      withExtra(publicKey, { alg: "Ed25519", ext: true, key_ops: ["verify"] }),
    );
    expect(JSON.parse(canonical)).toEqual({ kty: "OKP", crv: "Ed25519", x });
  });

  test("normalizeEd25519PublicKeyJwk rejects non-Ed25519 / private / garbage JWKs", () => {
    expect(() => normalizeEd25519PublicKeyJwk("{bad")).toThrow();
    expect(() => normalizeEd25519PublicKeyJwk(JSON.stringify({ kty: "RSA", x: "a" }))).toThrow();
    expect(() =>
      normalizeEd25519PublicKeyJwk(JSON.stringify({ kty: "OKP", crv: "X25519", x: "a" })),
    ).toThrow();
    expect(() =>
      normalizeEd25519PublicKeyJwk(JSON.stringify({ kty: "OKP", crv: "Ed25519", x: "a", d: "sk" })),
    ).toThrow();
  });
});

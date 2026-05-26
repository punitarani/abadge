import { describe, expect, test } from "bun:test";
import {
  generateServerDek,
  serverDecrypt,
  serverEncrypt,
  unwrapServerDek,
  wrapServerDek,
} from "../server/encrypt";
import {
  buildServerDekWrapAad,
  type ServerAadMeta,
  type ServerDekWrapAadMeta,
} from "../shared/aad";
import { fromBase64, toBase64 } from "../shared/encoding";

const MASTER = toBase64(new Uint8Array(32).fill(0x2a));
const DEK = new Uint8Array(32).fill(0x07);
const AAD: ServerAadMeta = { orgId: "org_g", profileId: "prf_g", itemId: "itm_g", keyVersion: 3 };
const WRAP_AAD: ServerDekWrapAadMeta = { orgId: "org_g", profileId: "prf_g" };

// Committed golden vectors (ENVELOPE_SPEC v3). Generated once with the fixed
// MASTER + DEK + wrap AAD above; any change to the wrap/encrypt wire format makes
// these committed values fail to decrypt, catching a silent format break.
const GOLDEN_WRAPPED_DEK =
  "AQIDBAUGBwgJCgsM82QeUY-RbM0HAiyr6lCzYqHcCFkKrkirv2dJa9jXhWS4CYAmgyNS3vfMY5IiuYXa";
const GOLDEN_V3_CIPHERTEXT = "2gZLR5451-bS-Q0ZfSMAUEidmODtad_0tA--_UYDqAKxcBlnD0s28z8";
const GOLDEN_V3_IV = "PPCzcCxeLd5bKsOf";
const GOLDEN_PAYLOAD = { v: 1, secret: "golden" };

// Encrypt arbitrary bytes under MASTER with the wrap AAD and a fixed IV, bypassing
// the 32-byte guard in wrapServerDek, to exercise the unwrap-side length check.
async function forgeWrappedBlob(plaintext: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", fromBase64(MASTER), { name: "AES-GCM" }, false, [
    "encrypt",
  ]);
  const iv = new Uint8Array(12).fill(9);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: buildServerDekWrapAad(WRAP_AAD) },
      key,
      plaintext,
    ),
  );
  const combined = new Uint8Array(iv.byteLength + ct.byteLength);
  combined.set(iv, 0);
  combined.set(ct, iv.byteLength);
  return toBase64(combined);
}

describe("server per-profile DEK envelope", () => {
  test("generateServerDek produces a 32-byte key", () => {
    expect(generateServerDek().byteLength).toBe(32);
  });

  test("wrap → unwrap round-trips the DEK", async () => {
    const dek = generateServerDek();
    const wrapped = await wrapServerDek(MASTER, dek, WRAP_AAD);
    const back = await unwrapServerDek(MASTER, wrapped, WRAP_AAD);
    expect(toBase64(back)).toBe(toBase64(dek));
  });

  test("wrapServerDek rejects a non-32-byte DEK", async () => {
    await expect(wrapServerDek(MASTER, new Uint8Array(16), WRAP_AAD)).rejects.toThrow(/32 bytes/);
  });

  test("a wrong master key cannot unwrap the DEK (rotation safety)", async () => {
    const wrapped = await wrapServerDek(MASTER, DEK, WRAP_AAD);
    const wrongMaster = toBase64(new Uint8Array(32).fill(0x99));
    await expect(unwrapServerDek(wrongMaster, wrapped, WRAP_AAD)).rejects.toThrow();
  });

  test("a wrapped DEK transplanted to another profile fails to unwrap", async () => {
    const wrapped = await wrapServerDek(MASTER, DEK, WRAP_AAD);
    const otherProfile: ServerDekWrapAadMeta = { orgId: "org_g", profileId: "prf_other" };
    await expect(unwrapServerDek(MASTER, wrapped, otherProfile)).rejects.toThrow();
  });

  test("unwrapServerDek rejects a wrapped blob whose payload is not 32 bytes", async () => {
    const forged = await forgeWrappedBlob(new Uint8Array(16).fill(0xab));
    await expect(unwrapServerDek(MASTER, forged, WRAP_AAD)).rejects.toThrow(/32 bytes/);
  });

  test("v3 item round-trips: encrypt under the DEK, decrypt under the DEK", async () => {
    const dekKey = toBase64(DEK);
    const payload = new TextEncoder().encode(JSON.stringify(GOLDEN_PAYLOAD));
    const enc = await serverEncrypt(payload, dekKey, 3, AAD);
    const dec = await serverDecrypt(enc, dekKey, AAD);
    expect(JSON.parse(new TextDecoder().decode(dec))).toEqual(GOLDEN_PAYLOAD);
  });

  test("cross-profile isolation: a different profile DEK cannot decrypt (acceptance #2)", async () => {
    const dekA = toBase64(generateServerDek());
    const dekB = toBase64(generateServerDek());
    const enc = await serverEncrypt(new TextEncoder().encode("secret"), dekA, 3, AAD);
    await expect(serverDecrypt(enc, dekB, AAD)).rejects.toThrow();
  });

  test("golden: committed wrapped DEK unwraps to the known DEK", async () => {
    const back = await unwrapServerDek(MASTER, GOLDEN_WRAPPED_DEK, WRAP_AAD);
    expect(toBase64(back)).toBe(toBase64(DEK));
  });

  test("golden: committed v3 ciphertext decrypts to the known payload", async () => {
    const dec = await serverDecrypt(
      { ciphertext: GOLDEN_V3_CIPHERTEXT, iv: GOLDEN_V3_IV, keyVersion: 3 },
      toBase64(DEK),
      AAD,
    );
    expect(JSON.parse(new TextDecoder().decode(dec))).toEqual(GOLDEN_PAYLOAD);
  });
});

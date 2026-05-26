import { describe, expect, test } from "bun:test";
import {
  generateServerDek,
  serverDecrypt,
  serverEncrypt,
  unwrapServerDek,
  wrapServerDek,
} from "../server/encrypt";
import type { ServerAadMeta } from "../shared/aad";
import { toBase64 } from "../shared/encoding";

const MASTER = toBase64(new Uint8Array(32).fill(0x2a));
const DEK = new Uint8Array(32).fill(0x07);
const AAD: ServerAadMeta = { orgId: "org_g", profileId: "prf_g", itemId: "itm_g", keyVersion: 3 };

// Committed golden vectors (§AB-0030 / ENVELOPE_SPEC). Generated once with the
// fixed MASTER + DEK above; any change to the wrap/encrypt wire format makes
// these committed values fail to decrypt, catching a silent format break.
const GOLDEN_WRAPPED_DEK =
  "YY71cGgYUPC_wx14yGBH-9ev2IUVg1Hbtty7tfO-PdD0fqsxzdgMDiMpn0eAAjQMR4BcQ_K-7d20_Rjg";
const GOLDEN_V3_CIPHERTEXT = "2gZLR5451-bS-Q0ZfSMAUEidmODtad_0tA--_UYDqAKxcBlnD0s28z8";
const GOLDEN_V3_IV = "PPCzcCxeLd5bKsOf";
const GOLDEN_PAYLOAD = { v: 1, secret: "golden" };

describe("server per-profile DEK envelope (§AB-0030)", () => {
  test("generateServerDek produces a 32-byte key", () => {
    expect(generateServerDek().byteLength).toBe(32);
  });

  test("wrap → unwrap round-trips the DEK", async () => {
    const dek = generateServerDek();
    const wrapped = await wrapServerDek(MASTER, dek);
    const back = await unwrapServerDek(MASTER, wrapped);
    expect(toBase64(back)).toBe(toBase64(dek));
  });

  test("wrapServerDek rejects a non-32-byte DEK", async () => {
    await expect(wrapServerDek(MASTER, new Uint8Array(16))).rejects.toThrow(/32 bytes/);
  });

  test("a wrong master key cannot unwrap the DEK (rotation safety)", async () => {
    const wrapped = await wrapServerDek(MASTER, DEK);
    const wrongMaster = toBase64(new Uint8Array(32).fill(0x99));
    await expect(unwrapServerDek(wrongMaster, wrapped)).rejects.toThrow();
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
    const back = await unwrapServerDek(MASTER, GOLDEN_WRAPPED_DEK);
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

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
const WRAP_AAD: ServerDekWrapAadMeta = { orgId: "org_g", profileId: "prf_g" };
const CONTENT_AAD: ServerAadMeta = {
  orgId: "org_g",
  profileId: "prf_g",
  itemId: "itm_g",
  keyVersion: 3,
};
const V2_AAD: ServerAadMeta = { ...CONTENT_AAD, keyVersion: 2 };
const PAYLOAD = { v: 1, secret: "golden" };

// Golden vectors generated once against the fixed MASTER/DEK/AAD above. Any
// change to the wrap or content wire format makes these committed values fail
// to decrypt, catching a silent format break. See docs/ENVELOPE_SPEC.md.
const GOLDEN_WRAPPED_DEK =
  "CzK4NZqVCt8q0u21LcjSTxmJP64DxWrydNGV40GZ7lxd8GPTAS7fU0K5MQe1JqB7eP_a1mJTseTr8C8Q";
const GOLDEN_V3 = {
  ciphertext: "jwIi2k1R7kFocq-cPabl-SlCDSHzVCyoTkR9JDrprJiM0jit_CF0js0",
  iv: "KDSlOUUiF42JK8Hz",
  keyVersion: 3,
};
const GOLDEN_V2 = {
  ciphertext: "c0DcaQsVIm5IA5bVm97miBJQyiI8cvz_pZ0O0fzVCMbfSewlPtxJQXA",
  iv: "JV80z3qqitW8tkhv",
  keyVersion: 2,
};

// Encrypt arbitrary-length plaintext under the master key + wrap AAD, in the
// `iv || ct+tag` layout unwrapServerDek expects. Only used to forge a GCM-valid
// blob whose plaintext is not 32 bytes — something the public wrap API (which
// rejects non-32-byte DEKs) can never produce — to exercise the length guard.
async function forgeWrapped(
  masterBase64: string,
  plaintext: Uint8Array,
  aad: ServerDekWrapAadMeta,
): Promise<string> {
  const raw = fromBase64(masterBase64);
  const key = await crypto.subtle.importKey(
    "raw",
    raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: buildServerDekWrapAad(aad) },
      key,
      plaintext,
    ),
  );
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(ciphertext, iv.byteLength);
  return toBase64(combined);
}

describe("server per-profile DEK envelope", () => {
  test("generateServerDek produces a 32-byte key", () => {
    expect(generateServerDek().byteLength).toBe(32);
  });

  test("wrap → unwrap round-trips the DEK under matching AAD", async () => {
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

  test("a different profile's AAD cannot unwrap the DEK (transplant blocked)", async () => {
    const wrapped = await wrapServerDek(MASTER, DEK, WRAP_AAD);
    await expect(
      unwrapServerDek(MASTER, wrapped, { ...WRAP_AAD, profileId: "prf_other" }),
    ).rejects.toThrow();
    await expect(
      unwrapServerDek(MASTER, wrapped, { ...WRAP_AAD, orgId: "org_other" }),
    ).rejects.toThrow();
  });

  test("unwrapServerDek rejects a GCM-valid blob whose plaintext is not 32 bytes", async () => {
    const forged = await forgeWrapped(MASTER, new Uint8Array(16).fill(0x05), WRAP_AAD);
    await expect(unwrapServerDek(MASTER, forged, WRAP_AAD)).rejects.toThrow(/32 bytes/);
  });

  test("master-key (KEK) rotation rewraps the DEK with content untouched (acceptance #4)", async () => {
    const oldMaster = MASTER;
    const newMaster = toBase64(new Uint8Array(32).fill(0x5c));
    const dek = generateServerDek();
    const payload = new TextEncoder().encode(JSON.stringify(PAYLOAD));
    const enc = await serverEncrypt(payload, toBase64(dek), 3, CONTENT_AAD);

    // Master rotation rewraps the DEK only; content is never re-encrypted.
    const wrappedOld = await wrapServerDek(oldMaster, dek, WRAP_AAD);
    const dekRotated = await unwrapServerDek(oldMaster, wrappedOld, WRAP_AAD);
    const wrappedNew = await wrapServerDek(newMaster, dekRotated, WRAP_AAD);

    const dekAfter = await unwrapServerDek(newMaster, wrappedNew, WRAP_AAD);
    const dec = await serverDecrypt(enc, toBase64(dekAfter), CONTENT_AAD);
    expect(JSON.parse(new TextDecoder().decode(dec))).toEqual(PAYLOAD);
    await expect(unwrapServerDek(oldMaster, wrappedNew, WRAP_AAD)).rejects.toThrow();
  });

  test("v3 item round-trips: encrypt under the DEK, decrypt under the DEK", async () => {
    const dekKey = toBase64(DEK);
    const payload = new TextEncoder().encode(JSON.stringify(PAYLOAD));
    const enc = await serverEncrypt(payload, dekKey, 3, CONTENT_AAD);
    const dec = await serverDecrypt(enc, dekKey, CONTENT_AAD);
    expect(JSON.parse(new TextDecoder().decode(dec))).toEqual(PAYLOAD);
  });

  test("cross-profile isolation: a different profile DEK cannot decrypt (acceptance #2)", async () => {
    const dekA = toBase64(generateServerDek());
    const dekB = toBase64(generateServerDek());
    const enc = await serverEncrypt(new TextEncoder().encode("secret"), dekA, 3, CONTENT_AAD);
    await expect(serverDecrypt(enc, dekB, CONTENT_AAD)).rejects.toThrow();
  });

  test("golden: committed wrapped DEK unwraps to the known DEK", async () => {
    const back = await unwrapServerDek(MASTER, GOLDEN_WRAPPED_DEK, WRAP_AAD);
    expect(toBase64(back)).toBe(toBase64(DEK));
  });

  test("golden: committed wrapped DEK fails under a different profile's AAD", async () => {
    await expect(
      unwrapServerDek(MASTER, GOLDEN_WRAPPED_DEK, { ...WRAP_AAD, profileId: "prf_other" }),
    ).rejects.toThrow();
  });

  test("golden: committed v3 ciphertext decrypts to the known payload", async () => {
    const dec = await serverDecrypt(GOLDEN_V3, toBase64(DEK), CONTENT_AAD);
    expect(JSON.parse(new TextDecoder().decode(dec))).toEqual(PAYLOAD);
  });

  test("golden: committed v2 direct-key ciphertext still decrypts (acceptance #3)", async () => {
    const dec = await serverDecrypt(GOLDEN_V2, MASTER, V2_AAD);
    expect(JSON.parse(new TextDecoder().decode(dec))).toEqual(PAYLOAD);
  });
});

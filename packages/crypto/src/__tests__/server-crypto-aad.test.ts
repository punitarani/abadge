import { describe, expect, test } from "bun:test";
import { serverDecrypt, serverEncrypt } from "../server/encrypt";
import type { ServerAadMeta } from "../shared/aad";
import { toBase64 } from "../shared/encoding";

const TEST_SERVER_KEY = toBase64(crypto.getRandomValues(new Uint8Array(32)));

const META: ServerAadMeta = {
  orgId: "org_abc",
  profileId: "prof_xyz",
  itemId: "item_123",
  keyVersion: 2,
};

describe("Server-managed encryption — AAD binding (W1S7-002)", () => {
  test("encrypt with AAD and decrypt with the same AAD round-trips", async () => {
    const plaintext = new TextEncoder().encode("hello-world");
    const encrypted = await serverEncrypt(plaintext, TEST_SERVER_KEY, META.keyVersion, META);
    const decrypted = await serverDecrypt(encrypted, TEST_SERVER_KEY, META);
    expect(new TextDecoder().decode(decrypted)).toBe("hello-world");
  });

  test("decrypt with mismatched orgId AAD fails (cross-org substitution blocked)", async () => {
    const plaintext = new TextEncoder().encode("secret");
    const encrypted = await serverEncrypt(plaintext, TEST_SERVER_KEY, META.keyVersion, META);

    const wrongOrg: ServerAadMeta = { ...META, orgId: "org_other" };
    expect(serverDecrypt(encrypted, TEST_SERVER_KEY, wrongOrg)).rejects.toThrow();
  });

  test("decrypt with mismatched itemId AAD fails (cross-item substitution blocked)", async () => {
    const plaintext = new TextEncoder().encode("secret");
    const encrypted = await serverEncrypt(plaintext, TEST_SERVER_KEY, META.keyVersion, META);

    const wrongItem: ServerAadMeta = { ...META, itemId: "item_other" };
    expect(serverDecrypt(encrypted, TEST_SERVER_KEY, wrongItem)).rejects.toThrow();
  });

  test("decrypt with mismatched profileId AAD fails", async () => {
    const plaintext = new TextEncoder().encode("secret");
    const encrypted = await serverEncrypt(plaintext, TEST_SERVER_KEY, META.keyVersion, META);

    const wrongProfile: ServerAadMeta = { ...META, profileId: "prof_other" };
    expect(serverDecrypt(encrypted, TEST_SERVER_KEY, wrongProfile)).rejects.toThrow();
  });

  test("decrypt with mismatched keyVersion AAD fails", async () => {
    const plaintext = new TextEncoder().encode("secret");
    const encrypted = await serverEncrypt(plaintext, TEST_SERVER_KEY, META.keyVersion, META);

    const wrongKv: ServerAadMeta = { ...META, keyVersion: 3 };
    expect(serverDecrypt(encrypted, TEST_SERVER_KEY, wrongKv)).rejects.toThrow();
  });

  test("v2 ciphertext cannot be decrypted without AAD", async () => {
    const plaintext = new TextEncoder().encode("secret");
    const encrypted = await serverEncrypt(plaintext, TEST_SERVER_KEY, META.keyVersion, META);
    expect(serverDecrypt(encrypted, TEST_SERVER_KEY)).rejects.toThrow();
  });

  test("v1 ciphertext (no AAD) round-trips without AAD — backward compat", async () => {
    const plaintext = new TextEncoder().encode("legacy-value");
    const encrypted = await serverEncrypt(plaintext, TEST_SERVER_KEY, 1);
    const decrypted = await serverDecrypt(encrypted, TEST_SERVER_KEY);
    expect(new TextDecoder().decode(decrypted)).toBe("legacy-value");
  });

  test("v1 ciphertext cannot be decrypted with AAD (AAD mismatch)", async () => {
    const plaintext = new TextEncoder().encode("legacy-value");
    const encrypted = await serverEncrypt(plaintext, TEST_SERVER_KEY, 1);
    expect(serverDecrypt(encrypted, TEST_SERVER_KEY, META)).rejects.toThrow();
  });

  test("v1 and v2 ciphertexts can coexist (caller branches on serverKeyVersion)", async () => {
    const plaintext = new TextEncoder().encode("same-plaintext");
    const v1 = await serverEncrypt(plaintext, TEST_SERVER_KEY, 1);
    const v2 = await serverEncrypt(plaintext, TEST_SERVER_KEY, 2, META);

    // Both decrypt successfully on their correct path.
    const decV1 = await serverDecrypt(v1, TEST_SERVER_KEY);
    const decV2 = await serverDecrypt(v2, TEST_SERVER_KEY, META);
    expect(new TextDecoder().decode(decV1)).toBe("same-plaintext");
    expect(new TextDecoder().decode(decV2)).toBe("same-plaintext");
  });
});

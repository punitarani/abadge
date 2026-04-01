import { describe, test, expect } from "bun:test";
import { generateApiKey, hashApiKey, verifyApiKey } from "../shared/api-keys.js";

describe("API keys", () => {
  test("generateApiKey returns key with prefix", async () => {
    const result = await generateApiKey("abg_");
    expect(result.key.startsWith("abg_")).toBe(true);
    expect(result.prefix).toBe(result.key.slice(0, 8));
    expect(result.hash.length).toBeGreaterThan(0);
  });

  test("hash is deterministic", async () => {
    const key = "abg_test123";
    const hash1 = await hashApiKey(key);
    const hash2 = await hashApiKey(key);
    expect(hash1).toBe(hash2);
  });

  test("different keys produce different hashes", async () => {
    const a = await generateApiKey("abg_");
    const b = await generateApiKey("abg_");
    expect(a.hash).not.toBe(b.hash);
  });

  test("verifyApiKey succeeds for correct key", async () => {
    const { key, hash } = await generateApiKey("abg_");
    expect(await verifyApiKey(key, hash)).toBe(true);
  });

  test("verifyApiKey fails for wrong key", async () => {
    const { hash } = await generateApiKey("abg_");
    expect(await verifyApiKey("abg_wrong", hash)).toBe(false);
  });
});

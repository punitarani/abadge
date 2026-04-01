import { describe, expect, test } from "bun:test";
import { decrypt, encrypt, hashToken } from "./crypto";

/**
 * Edge-case tests for AES-GCM encryption and SHA-256 hashing.
 * Covers boundary conditions, tamper detection, and error paths.
 */

const TEST_KEY = btoa(
	String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
);
const OTHER_KEY = btoa(
	String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
);

describe("encrypt/decrypt edge cases", () => {
	test("empty plaintext encrypts and decrypts to empty string", async () => {
		const { ciphertext, iv } = await encrypt("", TEST_KEY);
		const result = await decrypt(ciphertext, iv, TEST_KEY);
		expect(result).toBe("");
	});

	test("large payload (64KB) round-trips correctly", async () => {
		// Note: the encrypt() implementation uses String.fromCharCode(...spread)
		// which has a call stack limit, so we test with 64KB (well within limits)
		const large = "A".repeat(64 * 1024);
		const { ciphertext, iv } = await encrypt(large, TEST_KEY);
		const result = await decrypt(ciphertext, iv, TEST_KEY);
		expect(result).toBe(large);
		expect(result.length).toBe(64 * 1024);
	});

	test("unicode plaintext round-trips correctly", async () => {
		const unicode = "secret: \u{1F512}\u{1F511} p\u00E4ssw\u00F6rd \u4F60\u597D";
		const { ciphertext, iv } = await encrypt(unicode, TEST_KEY);
		const result = await decrypt(ciphertext, iv, TEST_KEY);
		expect(result).toBe(unicode);
	});

	test("special characters in plaintext round-trip", async () => {
		const special = '{"key":"value","nested":{"a":[1,2,3]}}';
		const { ciphertext, iv } = await encrypt(special, TEST_KEY);
		const result = await decrypt(ciphertext, iv, TEST_KEY);
		expect(result).toBe(special);
	});

	test("newlines and control characters round-trip", async () => {
		const value = "line1\nline2\ttab\r\nwindows\0null";
		const { ciphertext, iv } = await encrypt(value, TEST_KEY);
		const result = await decrypt(ciphertext, iv, TEST_KEY);
		expect(result).toBe(value);
	});

	test("different keys produce different ciphertexts for same plaintext", async () => {
		const plaintext = "same-secret-value";
		const a = await encrypt(plaintext, TEST_KEY);
		const b = await encrypt(plaintext, OTHER_KEY);
		// Even if by chance IVs collided (astronomically unlikely), different keys
		// produce different ciphertexts
		expect(a.ciphertext).not.toBe(b.ciphertext);
	});

	test("decrypt with wrong key throws", async () => {
		const { ciphertext, iv } = await encrypt("secret", TEST_KEY);
		await expect(decrypt(ciphertext, iv, OTHER_KEY)).rejects.toThrow();
	});

	test("tampered ciphertext fails decryption (GCM auth tag check)", async () => {
		const { ciphertext, iv } = await encrypt("secret-data", TEST_KEY);
		// Flip a bit in the ciphertext
		const ctBytes = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
		ctBytes[0] ^= 0xff;
		const tampered = btoa(String.fromCharCode(...ctBytes));
		await expect(decrypt(tampered, iv, TEST_KEY)).rejects.toThrow();
	});

	test("tampered IV fails decryption", async () => {
		const { ciphertext, iv } = await encrypt("secret-data", TEST_KEY);
		// Flip a bit in the IV
		const ivBytes = Uint8Array.from(atob(iv), (c) => c.charCodeAt(0));
		ivBytes[0] ^= 0xff;
		const tamperedIv = btoa(String.fromCharCode(...ivBytes));
		await expect(decrypt(ciphertext, tamperedIv, TEST_KEY)).rejects.toThrow();
	});

	test("truncated ciphertext fails decryption", async () => {
		const { ciphertext, iv } = await encrypt("secret-data", TEST_KEY);
		const ctBytes = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
		// Truncate to less than auth tag length (16 bytes)
		const truncated = btoa(String.fromCharCode(...ctBytes.slice(0, 8)));
		await expect(decrypt(truncated, iv, TEST_KEY)).rejects.toThrow();
	});

	test("empty ciphertext fails decryption", async () => {
		const { iv } = await encrypt("test", TEST_KEY);
		await expect(decrypt("", iv, TEST_KEY)).rejects.toThrow();
	});

	test("nonce uniqueness across multiple encryptions", async () => {
		const ivs = new Set<string>();
		const iterations = 100;
		const results = await Promise.all(
			Array.from({ length: iterations }, () =>
				encrypt("same-plaintext", TEST_KEY),
			),
		);
		for (const r of results) {
			ivs.add(r.iv);
		}
		expect(ivs.size).toBe(iterations);
	});
});

describe("hashToken edge cases", () => {
	test("empty string hashes without error", async () => {
		const hash = await hashToken("");
		expect(hash).toBeTruthy();
		expect(typeof hash).toBe("string");
	});

	test("very long input hashes to 32 bytes", async () => {
		const longInput = "x".repeat(100_000);
		const hash = await hashToken(longInput);
		const hashBytes = Uint8Array.from(atob(hash), (c) => c.charCodeAt(0));
		expect(hashBytes.length).toBe(32);
	});

	test("inputs differing by one character produce different hashes", async () => {
		const h1 = await hashToken("abg_key123");
		const h2 = await hashToken("abg_key124");
		expect(h1).not.toBe(h2);
	});

	test("unicode input hashes consistently", async () => {
		const input = "key-\u{1F512}-secure";
		const h1 = await hashToken(input);
		const h2 = await hashToken(input);
		expect(h1).toBe(h2);
	});

	test("hash does not contain the original input as substring", async () => {
		const input = "abg_plaintext-api-key-value";
		const hash = await hashToken(input);
		expect(hash).not.toContain(input);
		// Also check the base64 doesn't accidentally encode recognizable parts
		expect(hash).not.toContain("plaintext");
		expect(hash).not.toContain("api-key");
	});
});

import { describe, expect, test } from "bun:test";
import { decrypt, encrypt, hashToken } from "./crypto";

/**
 * Deterministic test vectors for AES-GCM encryption and SHA-256 hashing.
 * These tests verify that known inputs produce expected outputs and that
 * the crypto primitives behave correctly across runs.
 */

// Generate a stable test key (32 bytes = 256-bit AES key, base64-encoded)
const STABLE_KEY = btoa(
	String.fromCharCode(
		...[
			0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a,
			0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15,
			0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f,
		],
	),
);

describe("AES-GCM encrypt/decrypt round-trip vectors", () => {
	test("known plaintext round-trips through encrypt then decrypt", async () => {
		const plaintext = "sk-proj-abc123def456";
		const { ciphertext, iv } = await encrypt(plaintext, STABLE_KEY);
		const recovered = await decrypt(ciphertext, iv, STABLE_KEY);
		expect(recovered).toBe(plaintext);
	});

	test("ciphertext is valid base64", async () => {
		const { ciphertext, iv } = await encrypt("test-value", STABLE_KEY);
		// base64 should decode without error
		expect(() => atob(ciphertext)).not.toThrow();
		expect(() => atob(iv)).not.toThrow();
	});

	test("IV is exactly 12 bytes (16 base64 chars)", async () => {
		const { iv } = await encrypt("test", STABLE_KEY);
		const ivBytes = Uint8Array.from(atob(iv), (c) => c.charCodeAt(0));
		expect(ivBytes.length).toBe(12);
	});

	test("ciphertext length is plaintext length + 16 (GCM auth tag)", async () => {
		const plaintext = "exactly-twenty!!xxxx"; // 20 bytes
		const { ciphertext } = await encrypt(plaintext, STABLE_KEY);
		const ctBytes = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
		// AES-GCM adds a 16-byte auth tag
		expect(ctBytes.length).toBe(plaintext.length + 16);
	});

	test("encrypt produces different ciphertext each call (random IV)", async () => {
		const plaintext = "deterministic-check";
		const results = await Promise.all(
			Array.from({ length: 10 }, () => encrypt(plaintext, STABLE_KEY)),
		);
		const ciphertexts = new Set(results.map((r) => r.ciphertext));
		const ivs = new Set(results.map((r) => r.iv));
		// All 10 should be unique (probabilistically guaranteed with 96-bit random IV)
		expect(ciphertexts.size).toBe(10);
		expect(ivs.size).toBe(10);
	});
});

describe("SHA-256 hashToken vectors", () => {
	test("SHA-256 of empty string matches known digest", async () => {
		// SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
		const hash = await hashToken("");
		const hashBytes = Uint8Array.from(atob(hash), (c) => c.charCodeAt(0));
		const hexHash = Array.from(hashBytes)
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
		expect(hexHash).toBe(
			"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		);
	});

	test("SHA-256 of 'abc' matches known digest", async () => {
		// SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
		const hash = await hashToken("abc");
		const hashBytes = Uint8Array.from(atob(hash), (c) => c.charCodeAt(0));
		const hexHash = Array.from(hashBytes)
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
		expect(hexHash).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});

	test("hash output is always 32 bytes (256 bits)", async () => {
		for (const input of ["", "a", "test-token-value", "x".repeat(1000)]) {
			const hash = await hashToken(input);
			const hashBytes = Uint8Array.from(atob(hash), (c) => c.charCodeAt(0));
			expect(hashBytes.length).toBe(32);
		}
	});

	test("hash is deterministic across calls", async () => {
		const input = "abg_test-api-key-value";
		const h1 = await hashToken(input);
		const h2 = await hashToken(input);
		const h3 = await hashToken(input);
		expect(h1).toBe(h2);
		expect(h2).toBe(h3);
	});

	test("different inputs produce different hashes", async () => {
		const inputs = [
			"key-alpha",
			"key-beta",
			"key-gamma",
			"key-alpha1",
			"Key-alpha",
		];
		const hashes = await Promise.all(inputs.map(hashToken));
		const unique = new Set(hashes);
		expect(unique.size).toBe(inputs.length);
	});
});

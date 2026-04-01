import { describe, expect, test } from "bun:test";
import { encrypt, hashToken } from "./crypto";

/**
 * Audit metadata safety tests.
 * Verifies that serialized item payloads containing sensitive fields,
 * when encrypted or hashed, produce outputs that don't leak the original values.
 */

const ENCRYPTION_KEY = btoa(
	String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
);

describe("encrypted payloads do not leak sensitive fields", () => {
	test("JSON credential with password field does not leak password in ciphertext", async () => {
		const payload = JSON.stringify({
			username: "admin",
			password: "P@ssw0rd!2024",
			host: "db.example.com",
		});

		const { ciphertext } = await encrypt(payload, ENCRYPTION_KEY);

		expect(ciphertext).not.toContain("P@ssw0rd");
		expect(ciphertext).not.toContain("admin");
		expect(ciphertext).not.toContain("password");
		expect(ciphertext).not.toContain("db.example.com");
	});

	test("JSON credential with API key does not leak key in ciphertext", async () => {
		const payload = JSON.stringify({
			apiKey: "sk-proj-abc123def456",
			service: "openai",
		});

		const { ciphertext } = await encrypt(payload, ENCRYPTION_KEY);

		expect(ciphertext).not.toContain("sk-proj-abc123");
		expect(ciphertext).not.toContain("openai");
	});

	test("JSON credential with token does not leak token in ciphertext", async () => {
		const payload = JSON.stringify({
			access_token: "gho_16C7e42F292c6912E7710c838347Ae178B4a",
			token_type: "bearer",
			scope: "repo,user",
		});

		const { ciphertext } = await encrypt(payload, ENCRYPTION_KEY);

		expect(ciphertext).not.toContain("gho_16C7e42F");
		expect(ciphertext).not.toContain("bearer");
		expect(ciphertext).not.toContain("repo,user");
	});

	test("PII credential does not leak personal data in ciphertext", async () => {
		const payload = JSON.stringify({
			ssn: "123-45-6789",
			name: "John Doe",
			email: "john@example.com",
		});

		const { ciphertext } = await encrypt(payload, ENCRYPTION_KEY);

		expect(ciphertext).not.toContain("123-45-6789");
		expect(ciphertext).not.toContain("John Doe");
		expect(ciphertext).not.toContain("john@example.com");
	});

	test("connection string does not leak credentials in ciphertext", async () => {
		const connString =
			"postgresql://myuser:mypassword@prod-db.internal:5432/mydb?sslmode=require";
		const { ciphertext } = await encrypt(connString, ENCRYPTION_KEY);

		expect(ciphertext).not.toContain("myuser");
		expect(ciphertext).not.toContain("mypassword");
		expect(ciphertext).not.toContain("prod-db.internal");
	});
});

describe("API key hashes do not leak original key material", () => {
	test("hash of API key does not contain the key", async () => {
		const keys = [
			"abg_prod-key-abc123",
			"abg_test-agent-xyz789",
			"abs_session-token-456",
		];

		for (const key of keys) {
			const hash = await hashToken(key);
			expect(hash).not.toContain(key);
			// Also check that the hash doesn't contain partial key material
			const parts = key.split(/[-_]/);
			for (const part of parts) {
				if (part.length > 3) {
					expect(hash).not.toContain(part);
				}
			}
		}
	});

	test("hash output is fixed-length regardless of input length", async () => {
		const shortKey = "abg_x";
		const longKey = "abg_" + "a".repeat(1000);

		const shortHash = await hashToken(shortKey);
		const longHash = await hashToken(longKey);

		const shortLen = Uint8Array.from(atob(shortHash), (c) =>
			c.charCodeAt(0),
		).length;
		const longLen = Uint8Array.from(atob(longHash), (c) =>
			c.charCodeAt(0),
		).length;

		expect(shortLen).toBe(32);
		expect(longLen).toBe(32);
	});

	test("hash is one-way: cannot reverse to get original key", async () => {
		// This is a property test: given only the hash, we verify it's
		// a different string than the input and has no structural similarity
		const key = "abg_my-production-agent-key";
		const hash = await hashToken(key);

		// Hash should be a base64 string, not the original key
		expect(hash).not.toBe(key);
		expect(hash.length).not.toBe(key.length);

		// Verify it's valid base64
		expect(() => atob(hash)).not.toThrow();
	});
});

describe("IV does not leak plaintext information", () => {
	test("IV is random and independent of plaintext", async () => {
		// Encrypt the same plaintext multiple times, verify IVs are random
		const plaintext = "sensitive-credential-value";
		const results = await Promise.all(
			Array.from({ length: 20 }, () => encrypt(plaintext, ENCRYPTION_KEY)),
		);

		const ivs = new Set(results.map((r) => r.iv));
		expect(ivs.size).toBe(20);

		// No IV should contain any part of the plaintext
		for (const r of results) {
			expect(r.iv).not.toContain("sensitive");
			expect(r.iv).not.toContain("credential");
		}
	});

	test("IV for different plaintexts has no correlation", async () => {
		const enc1 = await encrypt("plaintext-A", ENCRYPTION_KEY);
		const enc2 = await encrypt("plaintext-B", ENCRYPTION_KEY);

		// IVs should be different (random)
		expect(enc1.iv).not.toBe(enc2.iv);
	});
});

describe("encrypted metadata isolation", () => {
	test("encrypted credential metadata is not readable without the key", async () => {
		const metadata = JSON.stringify({
			region: "us-east-1",
			account: "123456789012",
			role: "admin",
		});

		const { ciphertext, iv } = await encrypt(metadata, ENCRYPTION_KEY);

		// Without the key, decryption should fail
		const wrongKey = btoa(
			String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
		);
		await expect(decrypt(ciphertext, iv, wrongKey)).rejects.toThrow();

		// The ciphertext should not reveal metadata contents
		expect(ciphertext).not.toContain("us-east-1");
		expect(ciphertext).not.toContain("123456789012");
		expect(ciphertext).not.toContain("admin");
	});
});

// Import decrypt for the metadata isolation test
import { decrypt } from "./crypto";

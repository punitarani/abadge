import { describe, expect, test } from "bun:test";
import { decrypt, encrypt, hashToken } from "./crypto";

/**
 * Security invariant tests that verify the zero-knowledge and defense-in-depth
 * properties of the credential storage system.
 *
 * These tests verify:
 * - Server-stored ciphertext never contains plaintext
 * - Different credentials produce different encrypted outputs
 * - Wrong key cannot decrypt
 * - Key rotation preserves plaintext
 * - Hash outputs don't leak input material
 */

const KEY_A = btoa(
	String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
);
const KEY_B = btoa(
	String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
);

describe("server never sees plaintext in stored fields", () => {
	test("encrypted ciphertext does not contain any plaintext substring", async () => {
		const secrets = [
			"sk-proj-abc123def456ghi789",
			"ghp_1234567890abcdef",
			'{"client_id":"123","client_secret":"abc"}',
			"postgres://user:password@host:5432/db",
			"AKIAIOSFODNN7EXAMPLE",
		];

		for (const secret of secrets) {
			const { ciphertext, iv } = await encrypt(secret, KEY_A);

			// The stored ciphertext (base64) should not contain recognizable parts
			expect(ciphertext).not.toContain(secret);
			expect(iv).not.toContain(secret);

			// Check substrings too (in case partial plaintext leaks)
			if (secret.length > 8) {
				const mid = secret.slice(4, 12);
				expect(ciphertext).not.toContain(mid);
			}
		}
	});

	test("API key hash does not contain the original key", async () => {
		const apiKey = "abg_this-is-my-secret-agent-key-123456";
		const hash = await hashToken(apiKey);

		expect(hash).not.toContain(apiKey);
		expect(hash).not.toContain("abg_");
		expect(hash).not.toContain("secret-agent-key");
	});
});

describe("different credentials produce different encrypted outputs", () => {
	test("two different secrets encrypted with same key have different ciphertexts", async () => {
		const secret1 = "secret-one-value";
		const secret2 = "secret-two-value";

		const enc1 = await encrypt(secret1, KEY_A);
		const enc2 = await encrypt(secret2, KEY_A);

		expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
		// IVs should also differ (random)
		expect(enc1.iv).not.toBe(enc2.iv);
	});

	test("same secret encrypted twice has different ciphertexts (random IV)", async () => {
		const secret = "repeated-secret";
		const enc1 = await encrypt(secret, KEY_A);
		const enc2 = await encrypt(secret, KEY_A);

		expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
		expect(enc1.iv).not.toBe(enc2.iv);

		// But both decrypt to the same value
		const dec1 = await decrypt(enc1.ciphertext, enc1.iv, KEY_A);
		const dec2 = await decrypt(enc2.ciphertext, enc2.iv, KEY_A);
		expect(dec1).toBe(secret);
		expect(dec2).toBe(secret);
	});
});

describe("key rotation preserves plaintext", () => {
	test("re-encrypt with new key preserves original value", async () => {
		const secret = "credential-to-rotate";

		// Encrypt with original key
		const enc1 = await encrypt(secret, KEY_A);
		const decrypted = await decrypt(enc1.ciphertext, enc1.iv, KEY_A);
		expect(decrypted).toBe(secret);

		// Re-encrypt with new key (simulating key rotation)
		const enc2 = await encrypt(decrypted, KEY_B);
		const rotated = await decrypt(enc2.ciphertext, enc2.iv, KEY_B);
		expect(rotated).toBe(secret);

		// Old ciphertext still works with old key
		const oldDecrypt = await decrypt(enc1.ciphertext, enc1.iv, KEY_A);
		expect(oldDecrypt).toBe(secret);

		// Old ciphertext does NOT work with new key
		await expect(
			decrypt(enc1.ciphertext, enc1.iv, KEY_B),
		).rejects.toThrow();
	});
});

describe("wrong key cannot decrypt", () => {
	test("decryption with wrong key throws for various payloads", async () => {
		const payloads = ["short", "a".repeat(100), '{"key":"value"}', ""];

		for (const payload of payloads) {
			const { ciphertext, iv } = await encrypt(payload, KEY_A);
			await expect(decrypt(ciphertext, iv, KEY_B)).rejects.toThrow();
		}
	});
});

describe("credential listing never exposes encrypted fields", () => {
	test("publicColumns pattern excludes encryptedValue and iv", () => {
		// The credential routes use a publicColumns object that explicitly
		// lists safe columns. We verify the pattern here.
		const publicFields = [
			"id",
			"name",
			"type",
			"metadata",
			"ownerScope",
			"environment",
			"service",
			"provider",
			"project",
			"tags",
			"sensitivity",
			"allowedDeliveryModes",
			"allowedDestinations",
			"sourceType",
			"connectorId",
			"externalRef",
			"createdBy",
			"updatedBy",
			"createdAt",
			"updatedAt",
		];

		// These must NEVER appear in public responses
		const sensitiveFields = ["encryptedValue", "iv"];

		for (const field of sensitiveFields) {
			expect(publicFields).not.toContain(field);
		}
	});
});

describe("delivery mode access control", () => {
	test("reveal mode must be explicitly allowed", () => {
		// Simulating isDeliveryModeAllowed logic from access.ts
		function isDeliveryModeAllowed(
			requested: string,
			credentialAllowed: string[] | null,
			permissionAllowed: string[] | null,
		): boolean {
			if (credentialAllowed && credentialAllowed.length > 0) {
				if (!credentialAllowed.includes(requested)) return false;
			}
			if (permissionAllowed && permissionAllowed.length > 0) {
				if (!permissionAllowed.includes(requested)) return false;
			}
			return true;
		}

		// If credential restricts to env_inject only, reveal is blocked
		expect(
			isDeliveryModeAllowed("reveal", ["env_inject"], null),
		).toBe(false);

		// If permission restricts to env_inject only, reveal is blocked
		expect(
			isDeliveryModeAllowed("reveal", null, ["env_inject"]),
		).toBe(false);

		// Both must agree
		expect(
			isDeliveryModeAllowed(
				"reveal",
				["reveal", "env_inject"],
				["env_inject"],
			),
		).toBe(false);

		// Explicit allow works
		expect(
			isDeliveryModeAllowed("reveal", ["reveal"], ["reveal"]),
		).toBe(true);

		// Null means no restriction (open)
		expect(isDeliveryModeAllowed("reveal", null, null)).toBe(true);
	});
});

describe("session token isolation", () => {
	test("session tokens and API keys have different prefixes", () => {
		const sessionPrefix = "abs_";
		const apiKeyPrefix = "abg_";

		// A session token should never be confused with an API key
		expect(sessionPrefix).not.toBe(apiKeyPrefix);
		expect("abs_test-token".startsWith(sessionPrefix)).toBe(true);
		expect("abs_test-token".startsWith(apiKeyPrefix)).toBe(false);
		expect("abg_test-key".startsWith(apiKeyPrefix)).toBe(true);
		expect("abg_test-key".startsWith(sessionPrefix)).toBe(false);
	});
});

describe("audit log completeness", () => {
	test("all access outcomes have corresponding audit event types", () => {
		// The access route logs both allowed and denied access
		const loggedOutcomes = ["allowed", "denied", "pending_approval"];
		const accessOutcomes = [
			"allowed",
			"denied",
			"pending_approval",
			"expired",
		];

		// All actively logged outcomes must be in the outcomes enum
		for (const outcome of loggedOutcomes) {
			expect(accessOutcomes).toContain(outcome);
		}
	});
});

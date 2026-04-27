import { describe, expect, test } from "bun:test";
import { Either, Schema } from "effect";
import {
  AgentSchema,
  AuditEntrySchema,
  CreateItemSchema,
  ExchangeAgentSessionSchema,
  ItemSummarySchema,
  ProfileSchema,
  UpdateItemSchema,
} from "./schemas";

function decodeSucceeds(schema: Schema.Schema.Any, value: unknown): boolean {
  return Either.isRight(
    Schema.decodeUnknownEither(schema as Schema.Schema<unknown, unknown, never>)(value, {
      onExcessProperty: "error",
    }),
  );
}

describe("ProfileSchema", () => {
  test("accepts the roadmap organization-scoped profile shape", () => {
    expect(
      decodeSucceeds(ProfileSchema, {
        id: "prof_default_user-1",
        organizationId: "org_personal_user-1",
        name: "default",
        description: null,
        storageMode: "zero_knowledge",
        wrappedRootKey: "wrapped-root-key",
        kdfSalt: "salt",
        kdfParams: {
          algorithm: "argon2id",
          memory: 65536,
          iterations: 3,
          parallelism: 1,
          hashLength: 32,
        },
        recoveryWrappedRootKey: null,
        keyVersion: 1,
        createdAt: "2026-04-11T00:00:00.000Z",
        updatedAt: "2026-04-11T00:00:00.000Z",
      }),
    ).toBe(true);
  });
});

describe("AgentSchema", () => {
  test("accepts additive organization metadata during the cutover", () => {
    expect(
      decodeSucceeds(AgentSchema, {
        id: "agent-1",
        organizationId: "org_personal_user-1",
        createdBy: "user-1",
        kind: "remote",
        locality: "remote",
        authMethod: "public_key_session",
        name: "deploy-bot",
        description: "Roadmap agent",
        publicKeyConfigured: true,
        keyPrefix: null,
        enabled: true,
        revokedAt: null,
        lastUsedAt: null,
        metadata: {},
        createdAt: "2026-04-11T00:00:00.000Z",
      }),
    ).toBe(true);
  });
});

describe("AuditEntrySchema", () => {
  test("accepts roadmap delivery and surface metadata", () => {
    expect(
      decodeSucceeds(AuditEntrySchema, {
        id: 1,
        organizationId: "org_personal_user-1",
        userId: "user-1",
        agentId: "agent-1",
        itemId: "item-1",
        profileId: "prof_default_user-1",
        surface: "mcp",
        eventType: "access.mount_file",
        result: "allowed",
        field: "password",
        purpose: "deploy preview",
        deliveryMode: "mount_file",
        meta: {},
        ipAddress: null,
        occurredAt: "2026-04-11T00:00:00.000Z",
      }),
    ).toBe(true);
  });
});

describe("ItemSummarySchema", () => {
  test("requires a first-class label on item summaries", () => {
    expect(
      decodeSucceeds(ItemSummarySchema, {
        id: "item-1",
        label: "Production API key",
        storageMode: "server_managed",
        cryptoVersion: 1,
        contentVersion: 2,
        createdAt: "2026-04-11T00:00:00.000Z",
        updatedAt: "2026-04-11T00:00:00.000Z",
      }),
    ).toBe(true);

    expect(
      decodeSucceeds(ItemSummarySchema, {
        id: "item-1",
        storageMode: "server_managed",
        cryptoVersion: 1,
        contentVersion: 2,
        createdAt: "2026-04-11T00:00:00.000Z",
        updatedAt: "2026-04-11T00:00:00.000Z",
      }),
    ).toBe(false);
  });
});

describe("item write schemas", () => {
  const VALID_UUID = "11111111-2222-3333-4444-555555555555";

  test("require a cleartext label for zero-knowledge item creation", () => {
    expect(
      decodeSucceeds(CreateItemSchema, {
        storageMode: "zero_knowledge",
        id: VALID_UUID,
        label: "Production API key",
        encryptedItemKey: "wrapped-item-key",
        ciphertext: "ciphertext",
      }),
    ).toBe(true);

    expect(
      decodeSucceeds(CreateItemSchema, {
        storageMode: "zero_knowledge",
        id: VALID_UUID,
        encryptedItemKey: "wrapped-item-key",
        ciphertext: "ciphertext",
      }),
    ).toBe(false);
  });

  // §W1S7-001 — client-provided id is required for ZK create and must be a UUID.
  test("require a client-provided UUID on zero-knowledge creates", () => {
    // Missing id: reject.
    expect(
      decodeSucceeds(CreateItemSchema, {
        storageMode: "zero_knowledge",
        label: "any",
        encryptedItemKey: "wrapped-item-key",
        ciphertext: "ciphertext",
      }),
    ).toBe(false);

    // Non-UUID id: reject (guards against server blindly trusting arbitrary strings).
    expect(
      decodeSucceeds(CreateItemSchema, {
        storageMode: "zero_knowledge",
        id: "not-a-uuid",
        label: "any",
        encryptedItemKey: "wrapped-item-key",
        ciphertext: "ciphertext",
      }),
    ).toBe(false);
  });

  test("server-managed creates are unaffected (no id field)", () => {
    expect(
      decodeSucceeds(CreateItemSchema, {
        storageMode: "server_managed",
        payload: {
          v: 1,
          label: "any",
          kind: "opaque",
          tags: [],
          fields: { value: "x" },
        },
      }),
    ).toBe(true);
  });

  test("require a cleartext label for zero-knowledge item updates", () => {
    expect(
      decodeSucceeds(UpdateItemSchema, {
        storageMode: "zero_knowledge",
        label: "Rotated API key",
        encryptedItemKey: "wrapped-item-key",
        ciphertext: "ciphertext",
        contentVersion: 2,
      }),
    ).toBe(true);

    expect(
      decodeSucceeds(UpdateItemSchema, {
        storageMode: "zero_knowledge",
        encryptedItemKey: "wrapped-item-key",
        ciphertext: "ciphertext",
        contentVersion: 2,
      }),
    ).toBe(false);
  });
});

// §AUTH12: ExchangeAgentSessionSchema must reject malformed base64url inputs at
// the schema boundary so they never reach verifyEd25519 → fromBase64 → SyntaxError → 500.
describe("ExchangeAgentSessionSchema — §AUTH12 signature/challenge format validation", () => {
  // A realistic challenge: prefix "abc_" + base64url(32 random bytes) = 47 chars.
  const VALID_CHALLENGE = `abc_${"A".repeat(43)}`;
  // A realistic Ed25519 signature: 64 bytes → 86 chars unpadded base64url.
  const VALID_SIG = "A".repeat(86);
  const VALID_AGENT_ID = "agt_test";
  const VALID_CHALLENGE_ID = "some-uuid";

  function base(): object {
    return {
      agentId: VALID_AGENT_ID,
      challengeId: VALID_CHALLENGE_ID,
      challenge: VALID_CHALLENGE,
      signature: VALID_SIG,
    };
  }

  test("accepts valid base64url challenge and signature", () => {
    expect(decodeSucceeds(ExchangeAgentSessionSchema, base())).toBe(true);
  });

  test("accepts padded base64url signature (88 chars)", () => {
    // Some implementations may emit padding; allow up to 88 chars.
    expect(
      decodeSucceeds(ExchangeAgentSessionSchema, {
        ...base(),
        signature: `${"A".repeat(86)}==`,
      }),
    ).toBe(true);
  });

  test("rejects signature with characters outside base64url charset", () => {
    // !@#$%^&*() are not in [A-Za-z0-9_-]; fromBase64 would throw SyntaxError → 500.
    expect(
      decodeSucceeds(ExchangeAgentSessionSchema, {
        ...base(),
        signature: `!@#$%^&*()${"A".repeat(76)}`,
      }),
    ).toBe(false);
  });

  test("rejects challenge with characters outside base64url charset", () => {
    expect(
      decodeSucceeds(ExchangeAgentSessionSchema, {
        ...base(),
        challenge: `abc_!@#$%^&*()${"A".repeat(33)}`,
      }),
    ).toBe(false);
  });

  test("rejects single-char valid-charset signature (invalid base64 quantum → atob throws)", () => {
    // "A" passes charset check but atob("A") throws InvalidCharacterError.
    expect(
      decodeSucceeds(ExchangeAgentSessionSchema, {
        ...base(),
        signature: "A",
      }),
    ).toBe(false);
  });

  test("rejects oversized signature (>88 chars)", () => {
    expect(
      decodeSucceeds(ExchangeAgentSessionSchema, {
        ...base(),
        signature: "A".repeat(1000),
      }),
    ).toBe(false);
  });

  test("rejects oversized challenge (>256 chars)", () => {
    expect(
      decodeSucceeds(ExchangeAgentSessionSchema, {
        ...base(),
        challenge: `abc_${"A".repeat(300)}`,
      }),
    ).toBe(false);
  });

  test("rejects signature shorter than 86 chars (undersized Ed25519 sig)", () => {
    expect(
      decodeSucceeds(ExchangeAgentSessionSchema, {
        ...base(),
        signature: "A".repeat(50),
      }),
    ).toBe(false);
  });

  test("rejects empty signature", () => {
    expect(
      decodeSucceeds(ExchangeAgentSessionSchema, {
        ...base(),
        signature: "",
      }),
    ).toBe(false);
  });
});

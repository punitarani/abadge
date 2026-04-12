import { describe, expect, test } from "bun:test";
import { Either, Schema } from "effect";
import { AgentSchema, AuditEntrySchema, ItemSummarySchema, ProfileSchema } from "./schemas";

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

/**
 * Unit coverage for the row → DTO serializers and the audit-event-type alias
 * normaliser. These are pure functions over Drizzle row shapes; the
 * integration suite already exercises the happy path implicitly, this file
 * pins down null-handling, alias mapping, and the legacy-event branches.
 */

import { describe, expect, test } from "bun:test";
import {
  getAuditEventTypeFilters,
  normalizeAuditEventType,
  serializeAgent,
  serializeAuditEntry,
  serializeItemDetail,
  serializeItemSummary,
  serializePermission,
  serializeProfile,
} from "./serialize";

const ISO = (s: string) => new Date(s);

describe("normalizeAuditEventType", () => {
  test("forwards a known modern event type unchanged", () => {
    expect(normalizeAuditEventType("access.reveal")).toBe("access.reveal");
  });

  test("maps a legacy alias to its modern name", () => {
    expect(normalizeAuditEventType("vault.bootstrap")).toBe("profile.create");
    expect(normalizeAuditEventType("vault.password_change")).toBe("profile.rotate");
    expect(normalizeAuditEventType("vault.key_rotate")).toBe("profile.rotate");
    expect(normalizeAuditEventType("vault.unlock")).toBe("auth.login");
    expect(normalizeAuditEventType("operator_token.create")).toBe("auth.token_issue");
    expect(normalizeAuditEventType("operator_token.revoke")).toBe("auth.token_revoke");
    expect(normalizeAuditEventType("principal.create")).toBe("agent.create");
    expect(normalizeAuditEventType("principal.rotate")).toBe("agent.rotate");
    expect(normalizeAuditEventType("principal.revoke")).toBe("agent.revoke");
    expect(normalizeAuditEventType("grant.create")).toBe("permission.create");
    expect(normalizeAuditEventType("grant.revoke")).toBe("permission.revoke");
  });

  test("throws on a wholly unknown event type rather than serialising garbage", () => {
    expect(() => normalizeAuditEventType("totally-fake-event")).toThrow(/Unknown audit event/);
  });
});

describe("getAuditEventTypeFilters", () => {
  test("returns both the modern type and its legacy alias for each remap", () => {
    expect(getAuditEventTypeFilters("profile.create")).toEqual([
      "profile.create",
      "vault.bootstrap",
    ]);
    expect(getAuditEventTypeFilters("profile.rotate")).toEqual([
      "profile.rotate",
      "vault.password_change",
      "vault.key_rotate",
    ]);
    expect(getAuditEventTypeFilters("agent.create")).toEqual(["agent.create", "principal.create"]);
    expect(getAuditEventTypeFilters("permission.revoke")).toEqual([
      "permission.revoke",
      "grant.revoke",
    ]);
  });

  test("returns the singleton list for an event type with no aliases", () => {
    expect(getAuditEventTypeFilters("access.reveal")).toEqual(["access.reveal"]);
  });

  test("normalises legacy aliases at the input boundary", () => {
    expect(getAuditEventTypeFilters("vault.bootstrap")).toEqual([
      "profile.create",
      "vault.bootstrap",
    ]);
  });
});

describe("serializeProfile", () => {
  test("ISO-stringifies dates and preserves nullable fields", () => {
    const out = serializeProfile({
      id: "p1",
      organizationId: "o1",
      name: "internal",
      description: null,
      storageMode: "server_managed",
      wrappedRootKey: null,
      kdfSalt: null,
      kdfParams: null,
      recoveryWrappedRootKey: null,
      keyVersion: 1,
      createdAt: ISO("2026-01-01T00:00:00Z"),
      updatedAt: ISO("2026-01-02T00:00:00Z"),
    } as never);

    expect(out.id).toBe("p1");
    expect(out.description).toBeNull();
    expect(out.kdfParams).toBeNull();
    expect(out.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(out.updatedAt).toBe("2026-01-02T00:00:00.000Z");
  });

  test("forwards kdfParams when present", () => {
    const out = serializeProfile({
      id: "p2",
      organizationId: "o1",
      name: "secure",
      description: "primary",
      storageMode: "zero_knowledge",
      wrappedRootKey: "wr",
      kdfSalt: "salt",
      kdfParams: {
        algorithm: "argon2id",
        memory: 65536,
        iterations: 3,
        parallelism: 1,
        hashLength: 32,
      },
      recoveryWrappedRootKey: "recovery",
      keyVersion: 2,
      createdAt: ISO("2026-01-01T00:00:00Z"),
      updatedAt: ISO("2026-01-02T00:00:00Z"),
    } as never);

    expect(out.kdfParams).toEqual({
      algorithm: "argon2id",
      memory: 65536,
      iterations: 3,
      parallelism: 1,
      hashLength: 32,
    });
    expect(out.recoveryWrappedRootKey).toBe("recovery");
  });
});

describe("serializeItemSummary + serializeItemDetail", () => {
  test("summary keeps only the public fields", () => {
    const row = {
      id: "i1",
      label: "L",
      storageMode: "server_managed",
      cryptoVersion: 1,
      contentVersion: 1,
      createdAt: ISO("2026-01-01T00:00:00Z"),
      updatedAt: ISO("2026-01-02T00:00:00Z"),
    };
    const out = serializeItemSummary(row as never);
    expect(out).toEqual({
      id: "i1",
      label: "L",
      storageMode: "server_managed",
      cryptoVersion: 1,
      contentVersion: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
  });

  test("detail returns ZK envelope when storageMode === zero_knowledge", () => {
    const row = {
      id: "i_zk",
      label: "Z",
      storageMode: "zero_knowledge",
      cryptoVersion: 2,
      contentVersion: 1,
      profileId: "p1",
      encryptedItemKey: "eik",
      ciphertext: "ct",
      createdAt: ISO("2026-01-01T00:00:00Z"),
      updatedAt: ISO("2026-01-02T00:00:00Z"),
    };
    const out = serializeItemDetail(row as never);
    expect(out.storageMode).toBe("zero_knowledge");
    if (out.storageMode === "zero_knowledge") {
      expect(out.encryptedItemKey).toBe("eik");
      expect(out.ciphertext).toBe("ct");
      expect(out.profileId).toBe("p1");
    }
  });

  test("detail strips ZK fields and keeps server_managed shape when storageMode === server_managed", () => {
    const row = {
      id: "i_sm",
      label: "S",
      storageMode: "server_managed",
      cryptoVersion: 1,
      contentVersion: 1,
      profileId: null,
      encryptedItemKey: null,
      ciphertext: null,
      createdAt: ISO("2026-01-01T00:00:00Z"),
      updatedAt: ISO("2026-01-02T00:00:00Z"),
    };
    const out = serializeItemDetail(row as never);
    expect(out.storageMode).toBe("server_managed");
    expect(out.profileId).toBeNull();
    expect((out as Record<string, unknown>).ciphertext).toBeUndefined();
  });

  test("detail ZK with nullable encryptedItemKey/ciphertext falls back to empty strings", () => {
    const row = {
      id: "i_zk_partial",
      label: "ZP",
      storageMode: "zero_knowledge",
      cryptoVersion: 2,
      contentVersion: 1,
      profileId: "p1",
      encryptedItemKey: null,
      ciphertext: null,
      createdAt: ISO("2026-01-01T00:00:00Z"),
      updatedAt: ISO("2026-01-02T00:00:00Z"),
    };
    const out = serializeItemDetail(row as never);
    if (out.storageMode === "zero_knowledge") {
      expect(out.encryptedItemKey).toBe("");
      expect(out.ciphertext).toBe("");
    }
  });
});

describe("serializeAgent", () => {
  test("ISO-stringifies revokedAt + lastUsedAt and reflects publicKeyConfigured boolean", () => {
    const out = serializeAgent({
      id: "a1",
      organizationId: "o1",
      createdBy: "u1",
      kind: "remote",
      locality: "remote",
      authMethod: "public_key_session",
      name: "bot",
      description: "primary",
      publicKey: "pk",
      secretPrefix: null,
      enabled: true,
      revokedAt: ISO("2026-02-01T00:00:00Z"),
      lastUsedAt: ISO("2026-02-02T00:00:00Z"),
      metadata: { foo: "bar" },
      createdAt: ISO("2026-01-01T00:00:00Z"),
    } as never);

    expect(out.publicKeyConfigured).toBe(true);
    expect(out.revokedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(out.lastUsedAt).toBe("2026-02-02T00:00:00.000Z");
    expect(out.metadata).toEqual({ foo: "bar" });
  });

  test("publicKeyConfigured is false when row.publicKey is null", () => {
    const out = serializeAgent({
      id: "a2",
      organizationId: "o1",
      createdBy: "u1",
      kind: "local_cli",
      locality: "local",
      authMethod: "legacy_api_key",
      name: "legacy",
      description: null,
      publicKey: null,
      secretPrefix: "abl_",
      enabled: true,
      revokedAt: null,
      lastUsedAt: null,
      metadata: {},
      createdAt: ISO("2026-01-01T00:00:00Z"),
    } as never);

    expect(out.publicKeyConfigured).toBe(false);
    expect(out.revokedAt).toBeNull();
    expect(out.lastUsedAt).toBeNull();
    expect(out.keyPrefix).toBe("abl_");
  });
});

describe("serializePermission", () => {
  test("expiresAt nullable; createdAt ISO-stringified", () => {
    const out = serializePermission({
      id: "perm_1",
      organizationId: "o1",
      agentId: "a1",
      itemId: "i1",
      capability: "mount_env",
      expiresAt: null,
      grantedBy: "u1",
      createdAt: ISO("2026-01-01T00:00:00Z"),
    } as never);
    expect(out.expiresAt).toBeNull();
    expect(out.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  test("expiresAt is ISO-stringified when set", () => {
    const out = serializePermission({
      id: "perm_2",
      organizationId: "o1",
      agentId: "a1",
      itemId: "i1",
      capability: "mount_env",
      expiresAt: ISO("2026-12-01T00:00:00Z"),
      grantedBy: "u1",
      createdAt: ISO("2026-01-01T00:00:00Z"),
    } as never);
    expect(out.expiresAt).toBe("2026-12-01T00:00:00.000Z");
  });
});

describe("serializeAuditEntry", () => {
  test("normalises legacy event types and ISO-stringifies occurredAt", () => {
    const out = serializeAuditEntry({
      id: 1,
      organizationId: "o1",
      userId: "u1",
      agentId: null,
      itemId: null,
      profileId: null,
      surface: "auth",
      eventType: "vault.bootstrap",
      result: "allowed",
      deliveryMode: null,
      field: null,
      purpose: null,
      meta: null,
      ipAddress: null,
      occurredAt: ISO("2026-01-01T00:00:00Z"),
    } as never);
    expect(out.eventType).toBe("profile.create");
    expect(out.occurredAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

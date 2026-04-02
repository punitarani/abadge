import { describe, expect, test } from "bun:test";
import { Either, Schema } from "effect";
import {
  AGENT_KINDS,
  API_KEY_PREFIX,
  AUDIT_EVENT_TYPES,
  AUDIT_RESULTS,
  agentLocalityForKind,
  CAPABILITIES,
  ITEM_KINDS,
  STORAGE_MODES,
} from "./constants";
import {
  CreateAgentSchema,
  CreateItemSchema,
  CreatePermissionSchema,
  VaultBootstrapSchema,
} from "./schemas";

function isValid(schema: unknown, value: unknown): boolean {
  return Either.isRight(
    Schema.decodeUnknownEither(schema as Schema.Schema<unknown, unknown, never>)(value, {
      onExcessProperty: "error",
    }),
  );
}

describe("ITEM_KINDS", () => {
  test("includes all expected kinds", () => {
    const kinds = [...ITEM_KINDS];
    expect(kinds).toContain("login");
    expect(kinds).toContain("api_key");
    expect(kinds).toContain("token");
    expect(kinds).toContain("json");
    expect(kinds).toContain("certificate");
    expect(kinds).toContain("ssh_key");
    expect(kinds).toContain("opaque");
    expect(ITEM_KINDS.length).toBe(7);
  });
});

describe("STORAGE_MODES", () => {
  test("includes zero_knowledge and server_managed", () => {
    expect(STORAGE_MODES).toContain("zero_knowledge");
    expect(STORAGE_MODES).toContain("server_managed");
    expect(STORAGE_MODES.length).toBe(2);
  });
});

describe("AGENT_KINDS", () => {
  test("includes all expected kinds", () => {
    expect(AGENT_KINDS).toContain("device");
    expect(AGENT_KINDS).toContain("local_cli");
    expect(AGENT_KINDS).toContain("local_mcp");
    expect(AGENT_KINDS).toContain("remote_agent");
    expect(AGENT_KINDS.length).toBe(4);
  });
});

describe("CAPABILITIES", () => {
  test("includes all expected capabilities", () => {
    expect(CAPABILITIES).toContain("read_ciphertext");
    expect(CAPABILITIES).toContain("reveal_plaintext");
    expect(CAPABILITIES).toContain("mount_env");
    expect(CAPABILITIES).toContain("mount_file");
    expect(CAPABILITIES).toContain("use_without_reveal");
    expect(CAPABILITIES.length).toBe(5);
  });
});

describe("AUDIT_EVENT_TYPES", () => {
  test("includes vault events", () => {
    expect(AUDIT_EVENT_TYPES).toContain("vault.bootstrap");
    expect(AUDIT_EVENT_TYPES).toContain("vault.unlock");
    expect(AUDIT_EVENT_TYPES).toContain("vault.password_change");
    expect(AUDIT_EVENT_TYPES).toContain("vault.key_rotate");
  });

  test("includes access events", () => {
    expect(AUDIT_EVENT_TYPES).toContain("access.ciphertext");
    expect(AUDIT_EVENT_TYPES).toContain("access.reveal");
    expect(AUDIT_EVENT_TYPES).toContain("access.mount_env");
    expect(AUDIT_EVENT_TYPES).toContain("access.mount_file");
  });
});

describe("AUDIT_RESULTS", () => {
  test("includes all outcomes", () => {
    expect(AUDIT_RESULTS).toContain("allowed");
    expect(AUDIT_RESULTS).toContain("denied");
    expect(AUDIT_RESULTS).toContain("expired");
    expect(AUDIT_RESULTS).toContain("revoked");
  });
});

describe("agentLocalityForKind", () => {
  test("device is local", () => expect(agentLocalityForKind("device")).toBe("local"));
  test("local_cli is local", () => expect(agentLocalityForKind("local_cli")).toBe("local"));
  test("local_mcp is local", () => expect(agentLocalityForKind("local_mcp")).toBe("local"));
  test("remote_agent is remote", () => expect(agentLocalityForKind("remote_agent")).toBe("remote"));
});

describe("API_KEY_PREFIX", () => {
  test("remote prefix is abg_", () => expect(API_KEY_PREFIX.remote).toBe("abg_"));
  test("local prefix is abl_", () => expect(API_KEY_PREFIX.local).toBe("abl_"));
});

describe("schema validation", () => {
  test("VaultBootstrapSchema requires all fields", () => {
    expect(isValid(VaultBootstrapSchema, {})).toBe(false);
    expect(
      isValid(VaultBootstrapSchema, {
        wrappedRootKey: "key",
        kdfSalt: "salt",
        kdfParams: {
          algorithm: "argon2id",
          memory: 65536,
          iterations: 3,
          parallelism: 1,
          hashLength: 32,
        },
      }),
    ).toBe(true);
  });

  test("CreateItemSchema accepts ZK mode", () => {
    expect(
      isValid(CreateItemSchema, {
        storageMode: "zero_knowledge",
        encryptedItemKey: "key",
        ciphertext: "ct",
      }),
    ).toBe(true);
  });

  test("CreateItemSchema accepts server_managed mode", () => {
    expect(
      isValid(CreateItemSchema, {
        storageMode: "server_managed",
        payload: { v: 1, label: "test", kind: "opaque", tags: [], fields: {} },
      }),
    ).toBe(true);
  });

  test("CreatePermissionSchema rejects invalid capability", () => {
    expect(
      isValid(CreatePermissionSchema, {
        agentId: "p1",
        itemId: "i1",
        capability: "wildcard",
      }),
    ).toBe(false);
  });

  test("CreatePermissionSchema accepts valid capability", () => {
    expect(
      isValid(CreatePermissionSchema, {
        agentId: "p1",
        itemId: "i1",
        capability: "read_ciphertext",
      }),
    ).toBe(true);
  });

  test("CreateAgentSchema requires name and kind", () => {
    expect(isValid(CreateAgentSchema, {})).toBe(false);
    expect(isValid(CreateAgentSchema, { kind: "remote_agent", name: "my-agent" })).toBe(true);
  });
});

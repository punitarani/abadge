import { describe, expect, test } from "bun:test";
import {
  AUDIT_EVENT_TYPES,
  AUDIT_RESULTS,
  CAPABILITIES,
  ITEM_KINDS,
  PRINCIPAL_KINDS,
  PRINCIPAL_LOCALITIES,
  STORAGE_MODES,
  API_KEY_PREFIX,
  localityForKind,
} from "./constants";
import {
  CreateGrantSchema,
  CreateItemSchema,
  CreatePrincipalSchema,
  VaultBootstrapSchema,
} from "./schemas";

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

describe("PRINCIPAL_KINDS", () => {
  test("includes all expected kinds", () => {
    expect(PRINCIPAL_KINDS).toContain("device");
    expect(PRINCIPAL_KINDS).toContain("local_cli");
    expect(PRINCIPAL_KINDS).toContain("local_mcp");
    expect(PRINCIPAL_KINDS).toContain("remote_agent");
    expect(PRINCIPAL_KINDS.length).toBe(4);
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

describe("localityForKind", () => {
  test("device is local", () => expect(localityForKind("device")).toBe("local"));
  test("local_cli is local", () => expect(localityForKind("local_cli")).toBe("local"));
  test("local_mcp is local", () => expect(localityForKind("local_mcp")).toBe("local"));
  test("remote_agent is remote", () => expect(localityForKind("remote_agent")).toBe("remote"));
});

describe("API_KEY_PREFIX", () => {
  test("remote prefix is abg_", () => expect(API_KEY_PREFIX.remote).toBe("abg_"));
  test("local prefix is abl_", () => expect(API_KEY_PREFIX.local).toBe("abl_"));
});

describe("schema validation", () => {
  test("VaultBootstrapSchema requires all fields", () => {
    expect(VaultBootstrapSchema.safeParse({}).success).toBe(false);
    expect(
      VaultBootstrapSchema.safeParse({
        wrappedRootKey: "key",
        kdfSalt: "salt",
        kdfParams: {
          algorithm: "argon2id",
          memory: 65536,
          iterations: 3,
          parallelism: 1,
          hashLength: 32,
        },
      }).success,
    ).toBe(true);
  });

  test("CreateItemSchema accepts ZK mode", () => {
    expect(
      CreateItemSchema.safeParse({
        storageMode: "zero_knowledge",
        encryptedItemKey: "key",
        ciphertext: "ct",
      }).success,
    ).toBe(true);
  });

  test("CreateItemSchema accepts server_managed mode", () => {
    expect(
      CreateItemSchema.safeParse({
        storageMode: "server_managed",
        payload: { v: 1, label: "test", kind: "opaque", tags: [], fields: {} },
      }).success,
    ).toBe(true);
  });

  test("CreateGrantSchema rejects invalid capability", () => {
    expect(
      CreateGrantSchema.safeParse({
        principalId: "p1",
        itemId: "i1",
        capability: "wildcard",
      }).success,
    ).toBe(false);
  });

  test("CreateGrantSchema accepts valid capability", () => {
    expect(
      CreateGrantSchema.safeParse({
        principalId: "p1",
        itemId: "i1",
        capability: "read_ciphertext",
      }).success,
    ).toBe(true);
  });

  test("CreatePrincipalSchema requires name and kind", () => {
    expect(CreatePrincipalSchema.safeParse({}).success).toBe(false);
    expect(
      CreatePrincipalSchema.safeParse({ kind: "remote_agent", name: "my-agent" }).success,
    ).toBe(true);
  });
});

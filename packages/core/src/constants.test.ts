import { describe, expect, test } from "bun:test";
import { Either, Schema } from "effect";
import {
  AGENT_BOOTSTRAP_PREFIX,
  AGENT_BOOTSTRAP_TTL_MS,
  AGENT_CHALLENGE_PREFIX,
  AGENT_CHALLENGE_TTL_MS,
  AGENT_KINDS,
  AGENT_SESSION_PREFIX,
  AGENT_SESSION_REFRESH_BUFFER_MS,
  AGENT_SESSION_TTL_MS,
  AUDIT_EVENT_TYPES,
  AUDIT_RESULTS,
  agentLocalityForKind,
  CAPABILITY_MATRIX,
  getAllowedCapabilities,
  isCapabilityAllowed,
  STANDARD_FIELDS_BY_KIND,
} from "./constants";
import { CreateAgentSchema, ItemPayloadSchema } from "./schemas";

function isValid(schema: unknown, value: unknown): boolean {
  return Either.isRight(
    Schema.decodeUnknownEither(schema as Schema.Schema<unknown, unknown, never>)(value, {
      onExcessProperty: "error",
    }),
  );
}

describe("AGENT_KINDS", () => {
  test("matches the roadmap kinds exactly", () => {
    expect(AGENT_KINDS).toEqual(["local_cli", "local_mcp", "remote"]);
  });
});

describe("agentLocalityForKind", () => {
  test("maps local runtimes to local locality", () => {
    expect(agentLocalityForKind("local_cli")).toBe("local");
    expect(agentLocalityForKind("local_mcp")).toBe("local");
  });

  test("maps remote agents to remote locality", () => {
    expect(agentLocalityForKind("remote")).toBe("remote");
  });

  test("maps legacy device agents to local locality during cutover", () => {
    expect(agentLocalityForKind("device")).toBe("local");
  });
});

describe("STANDARD_FIELDS_BY_KIND", () => {
  test("defines standard login fields used by CLI prompts and delivery helpers", () => {
    expect(STANDARD_FIELDS_BY_KIND.login).toEqual([
      "username",
      "email",
      "password",
      "url",
      "totp_secret",
    ]);
  });

  test("keeps single-value kinds explicitly defaultable", () => {
    expect(STANDARD_FIELDS_BY_KIND.api_key).toEqual(["value", "key_id", "key_secret"]);
    expect(STANDARD_FIELDS_BY_KIND.token).toEqual(["value"]);
    expect(STANDARD_FIELDS_BY_KIND.opaque).toEqual(["value"]);
  });
});

describe("agent auth constants", () => {
  test("uses distinct token prefixes", () => {
    expect(AGENT_BOOTSTRAP_PREFIX).toBe("abe_");
    expect(AGENT_CHALLENGE_PREFIX).toBe("abc_");
    expect(AGENT_SESSION_PREFIX).toBe("abs_");
  });

  test("uses the expected auth timing windows", () => {
    expect(AGENT_BOOTSTRAP_TTL_MS).toBe(10 * 60 * 1000);
    expect(AGENT_CHALLENGE_TTL_MS).toBe(60 * 1000);
    expect(AGENT_SESSION_TTL_MS).toBe(15 * 60 * 1000);
    expect(AGENT_SESSION_REFRESH_BUFFER_MS).toBe(2 * 60 * 1000);
  });
});

describe("AUDIT_RESULTS", () => {
  test("includes cascade outcomes for downstream revocation and deletion effects", () => {
    expect(AUDIT_RESULTS).toEqual(["allowed", "denied", "expired", "revoked", "cascade"]);
  });
});

describe("AUDIT_EVENT_TYPES", () => {
  test("tracks the roadmap audit surface instead of legacy vault or operator-token events", () => {
    expect(AUDIT_EVENT_TYPES).toContain("item.export");
    expect(AUDIT_EVENT_TYPES).toContain("profile.create");
    expect(AUDIT_EVENT_TYPES).toContain("profile.rotate");
    expect(AUDIT_EVENT_TYPES).toContain("agent.revoke_cascade");
    expect(AUDIT_EVENT_TYPES).toContain("permission.revoke_cascade");
    expect(AUDIT_EVENT_TYPES).toContain("item.delete_cascade");
    expect(AUDIT_EVENT_TYPES).not.toContain("vault.bootstrap");
    expect(AUDIT_EVENT_TYPES).not.toContain("vault.unlock");
    expect(AUDIT_EVENT_TYPES).not.toContain("vault.password_change");
    expect(AUDIT_EVENT_TYPES).not.toContain("vault.key_rotate");
    expect(AUDIT_EVENT_TYPES).not.toContain("operator_token.create");
    expect(AUDIT_EVENT_TYPES).not.toContain("operator_token.revoke");
  });

  test("includes org, profile, and auth event types for comprehensive audit coverage", () => {
    expect(AUDIT_EVENT_TYPES).toContain("org.create");
    expect(AUDIT_EVENT_TYPES).toContain("org.update");
    expect(AUDIT_EVENT_TYPES).toContain("org.delete");
    expect(AUDIT_EVENT_TYPES).toContain("org.invite");
    expect(AUDIT_EVENT_TYPES).toContain("org.member_remove");
    expect(AUDIT_EVENT_TYPES).toContain("org.member_role_change");
    expect(AUDIT_EVENT_TYPES).toContain("profile.setup_recovery");
    expect(AUDIT_EVENT_TYPES).toContain("profile.delete");
    expect(AUDIT_EVENT_TYPES).toContain("auth.signup");
  });
});

describe("CAPABILITY_MATRIX", () => {
  test("allows local runtimes to mount or read ciphertext without remote-only capabilities", () => {
    expect(CAPABILITY_MATRIX.local.zero_knowledge).toEqual([
      "read_ciphertext",
      "mount_env",
      "mount_file",
    ]);
    expect(CAPABILITY_MATRIX.local.server_managed).toEqual([
      "reveal_plaintext",
      "mount_env",
      "mount_file",
    ]);
  });

  test("restricts remote runtimes to plaintext reveal on server-managed items", () => {
    expect(getAllowedCapabilities("remote", "zero_knowledge")).toEqual([]);
    expect(getAllowedCapabilities("remote", "server_managed")).toEqual(["reveal_plaintext"]);
    expect(isCapabilityAllowed("reveal_plaintext", "remote", "server_managed")).toBe(true);
    expect(isCapabilityAllowed("mount_env", "remote", "server_managed")).toBe(false);
    expect(isCapabilityAllowed("read_ciphertext", "local", "server_managed")).toBe(false);
  });
});

describe("schema validation", () => {
  test("CreateAgentSchema accepts the roadmap remote kind", () => {
    expect(
      isValid(CreateAgentSchema, {
        kind: "remote",
        name: "deploy-bot",
      }),
    ).toBe(true);
  });

  test("CreateAgentSchema rejects the pre-roadmap remote_agent kind", () => {
    expect(
      isValid(CreateAgentSchema, {
        kind: "remote_agent",
        name: "legacy-remote-agent",
      }),
    ).toBe(false);
  });

  test("ItemPayloadSchema only requires a fields map", () => {
    expect(
      isValid(ItemPayloadSchema, {
        fields: { username: "alice", password: "secret" },
      }),
    ).toBe(true);
  });
});

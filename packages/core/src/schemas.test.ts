import { describe, expect, test } from "bun:test";
import {
  AgentAccessRequestSchema,
  CreateCredentialSchema,
  CreateSessionSchema,
  PolicyRuleSchema,
} from "./schemas";

describe("CreateCredentialSchema", () => {
  test("rejects empty name", () => {
    const result = CreateCredentialSchema.safeParse({ name: "", type: "api_key", value: "v" });
    expect(result.success).toBe(false);
  });

  test("rejects missing type", () => {
    const result = CreateCredentialSchema.safeParse({ name: "cred", value: "v" });
    expect(result.success).toBe(false);
  });

  test("rejects missing value", () => {
    const result = CreateCredentialSchema.safeParse({ name: "cred", type: "api_key" });
    expect(result.success).toBe(false);
  });

  test("accepts valid input", () => {
    const result = CreateCredentialSchema.safeParse({
      name: "my-key",
      type: "api_key",
      value: "sk-123",
    });
    expect(result.success).toBe(true);
  });
});

describe("AgentAccessRequestSchema", () => {
  test("defaults deliveryMode to env_inject", () => {
    const result = AgentAccessRequestSchema.safeParse({ credentialName: "cred" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deliveryMode).toBe("env_inject");
    }
  });

  test("requires credentialName or credentialId", () => {
    const result = AgentAccessRequestSchema.safeParse({ purpose: "test" });
    expect(result.success).toBe(false);
  });

  test("accepts credentialId alone", () => {
    const result = AgentAccessRequestSchema.safeParse({
      credentialId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.success).toBe(true);
  });
});

describe("PolicyRuleSchema", () => {
  test("rejects unknown type", () => {
    const result = PolicyRuleSchema.safeParse({ type: "unknown_type" });
    expect(result.success).toBe(false);
  });

  test("accepts valid delivery_mode rule", () => {
    const result = PolicyRuleSchema.safeParse({
      type: "delivery_mode",
      deliveryModes: ["env_inject"],
    });
    expect(result.success).toBe(true);
  });
});

describe("CreateSessionSchema", () => {
  test("rejects ttlSeconds > 86400", () => {
    const result = CreateSessionSchema.safeParse({ agentId: "a1", ttlSeconds: 86401 });
    expect(result.success).toBe(false);
  });

  test("accepts valid input", () => {
    const result = CreateSessionSchema.safeParse({ agentId: "a1", ttlSeconds: 3600 });
    expect(result.success).toBe(true);
  });
});

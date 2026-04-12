import { describe, expect, test } from "bun:test";
import { AbadgeAgentClient } from "./client";

describe("AbadgeAgentClient privateKey string support", () => {
  test("accepts a JWK JSON string as privateKey", () => {
    const jwk = {
      kty: "OKP",
      crv: "Ed25519",
      x: "test-public",
      d: "test-private",
    };

    // Should not throw during construction
    const client = new AbadgeAgentClient({
      apiUrl: "https://api.example.com",
      agentId: "agent_123",
      privateKey: JSON.stringify(jwk),
    });

    expect(client).toBeDefined();
  });

  test("rejects invalid JSON strings for privateKey", () => {
    expect(() => {
      new AbadgeAgentClient({
        apiUrl: "https://api.example.com",
        agentId: "agent_123",
        privateKey: "not-valid-json",
      });
    }).toThrow();
  });

  test("rejects non-object JSON strings for privateKey", () => {
    expect(() => {
      new AbadgeAgentClient({
        apiUrl: "https://api.example.com",
        agentId: "agent_123",
        privateKey: '"just-a-string"',
      });
    }).toThrow();
  });
});

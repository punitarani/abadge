import { describe, expect, test } from "bun:test";
import type { CliProfileConfig } from "@abadge/core";
import { mergeLoginConfig } from "./config";

const existingConfig: CliProfileConfig = {
  apiUrl: "https://api.abadge.dev",
  operatorUserId: "user_123",
  profileName: "default",
  localAgents: {
    cli: {
      agentId: "agent_cli",
      privateKeyPath: "/tmp/cli.jwk",
    },
    mcp: {
      agentId: "agent_mcp",
      privateKeyPath: "/tmp/mcp.jwk",
    },
  },
};

describe("mergeLoginConfig", () => {
  test("preserves local agents for the same operator on the same API", () => {
    expect(mergeLoginConfig(existingConfig.apiUrl, existingConfig, "user_123")).toEqual(
      existingConfig,
    );
  });

  test("reprovisions local agents when the operator changes", () => {
    expect(mergeLoginConfig(existingConfig.apiUrl, existingConfig, "user_456")).toEqual({
      apiUrl: existingConfig.apiUrl,
      operatorUserId: "user_456",
      profileName: "default",
    });
  });

  test("reprovisions local agents when the API URL changes", () => {
    expect(mergeLoginConfig("https://api.other.dev", existingConfig, "user_123")).toEqual({
      apiUrl: "https://api.other.dev",
      operatorUserId: "user_123",
      profileName: "default",
    });
  });
});

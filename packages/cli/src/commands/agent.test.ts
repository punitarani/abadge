import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { buildMcpConfigSnippet, configSlotForKind, defaultMcpBinaryPath } from "./agent";

describe("configSlotForKind", () => {
  test("local_cli maps to the cli slot", () => {
    expect(configSlotForKind("local_cli")).toBe("cli");
  });

  test("local_mcp maps to the mcp slot", () => {
    expect(configSlotForKind("local_mcp")).toBe("mcp");
  });

  test("remote maps to null so no local slot is written", () => {
    // Remote agents don't run on the user's machine; registering one must
    // not overwrite ~/.abadge/config.json's localAgents.cli or .mcp entries.
    expect(configSlotForKind("remote")).toBeNull();
  });
});

describe("buildMcpConfigSnippet", () => {
  test("emits the Claude Desktop mcpServers shape with absolute paths", () => {
    const snippet = buildMcpConfigSnippet({
      agentId: "agent_abc123",
      apiUrl: "https://api.abadge.io",
      privateKeyPath: "/Users/punit/.abadge/agents/agent_abc123.ed25519.jwk",
      binaryPath: "/Users/punit/.abadge/bin/abadge-mcp",
    });

    expect(JSON.parse(snippet)).toEqual({
      mcpServers: {
        abadge: {
          command: "/Users/punit/.abadge/bin/abadge-mcp",
          env: {
            ABADGE_API_URL: "https://api.abadge.io",
            ABADGE_AGENT_ID: "agent_abc123",
            ABADGE_PRIVATE_KEY_PATH: "/Users/punit/.abadge/agents/agent_abc123.ed25519.jwk",
          },
        },
      },
    });
  });

  test("output is pretty-printed JSON for direct paste into config files", () => {
    const snippet = buildMcpConfigSnippet({
      agentId: "agent_x",
      apiUrl: "http://localhost:8787",
      privateKeyPath: "/k.jwk",
      binaryPath: "/b/abadge-mcp",
    });
    expect(snippet).toContain("\n  ");
    expect(snippet).toContain('"mcpServers"');
  });
});

describe("defaultMcpBinaryPath", () => {
  let originalInstallDir: string | undefined;

  beforeEach(() => {
    originalInstallDir = process.env.ABADGE_INSTALL_DIR;
  });

  afterEach(() => {
    if (originalInstallDir === undefined) {
      delete process.env.ABADGE_INSTALL_DIR;
    } else {
      process.env.ABADGE_INSTALL_DIR = originalInstallDir;
    }
  });

  test("falls back to ~/.abadge/bin/abadge-mcp when ABADGE_INSTALL_DIR is unset", () => {
    delete process.env.ABADGE_INSTALL_DIR;
    expect(defaultMcpBinaryPath()).toBe(join(homedir(), ".abadge", "bin", "abadge-mcp"));
  });

  test("respects ABADGE_INSTALL_DIR when the operator has a custom install location", () => {
    process.env.ABADGE_INSTALL_DIR = "/opt/abadge/bin";
    expect(defaultMcpBinaryPath()).toBe("/opt/abadge/bin/abadge-mcp");
  });
});

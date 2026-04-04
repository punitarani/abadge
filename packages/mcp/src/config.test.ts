import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config";

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_ABADGE_API_URL = process.env.ABADGE_API_URL;
const ORIGINAL_ABADGE_AUTH_TOKEN = process.env.ABADGE_AUTH_TOKEN;
const ORIGINAL_ABADGE_AGENT_ID = process.env.ABADGE_AGENT_ID;
const ORIGINAL_ABADGE_PRIVATE_KEY_PATH = process.env.ABADGE_PRIVATE_KEY_PATH;
const ORIGINAL_ABADGE_MCP_AGENT_ID = process.env.ABADGE_MCP_AGENT_ID;
const ORIGINAL_ABADGE_MCP_PRIVATE_KEY_PATH = process.env.ABADGE_MCP_PRIVATE_KEY_PATH;

function writeConfig(home: string, config: unknown): void {
  const configDir = join(home, ".abadge");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "config.json"), JSON.stringify(config, null, 2));
}

afterEach(() => {
  if (ORIGINAL_HOME === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = ORIGINAL_HOME;
  }

  for (const [key, value] of [
    ["ABADGE_API_URL", ORIGINAL_ABADGE_API_URL],
    ["ABADGE_AUTH_TOKEN", ORIGINAL_ABADGE_AUTH_TOKEN],
    ["ABADGE_AGENT_ID", ORIGINAL_ABADGE_AGENT_ID],
    ["ABADGE_PRIVATE_KEY_PATH", ORIGINAL_ABADGE_PRIVATE_KEY_PATH],
    ["ABADGE_MCP_AGENT_ID", ORIGINAL_ABADGE_MCP_AGENT_ID],
    ["ABADGE_MCP_PRIVATE_KEY_PATH", ORIGINAL_ABADGE_MCP_PRIVATE_KEY_PATH],
  ] as const) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("loadConfig", () => {
  test("ignores legacy bearer tokens persisted in config.json", () => {
    const home = mkdtempSync(join(tmpdir(), "abadge-mcp-config-"));
    process.env.HOME = home;
    delete process.env.ABADGE_API_URL;
    delete process.env.ABADGE_AUTH_TOKEN;
    delete process.env.ABADGE_AGENT_ID;
    delete process.env.ABADGE_PRIVATE_KEY_PATH;
    delete process.env.ABADGE_MCP_AGENT_ID;
    delete process.env.ABADGE_MCP_PRIVATE_KEY_PATH;

    writeConfig(home, {
      apiUrl: "http://localhost:8787",
      token: "session_token_from_legacy_config",
    });

    expect(() => loadConfig()).toThrow(
      "Set ABADGE_AGENT_ID and ABADGE_PRIVATE_KEY_PATH, or run `abadge login` to provision local agent metadata.",
    );

    rmSync(home, { recursive: true, force: true });
  });

  test("still allows explicit legacy auth tokens from the environment during migration", () => {
    const home = mkdtempSync(join(tmpdir(), "abadge-mcp-config-"));
    process.env.HOME = home;
    process.env.ABADGE_API_URL = "http://localhost:8787";
    process.env.ABADGE_AUTH_TOKEN = "abl_legacy_token";
    delete process.env.ABADGE_AGENT_ID;
    delete process.env.ABADGE_PRIVATE_KEY_PATH;
    delete process.env.ABADGE_MCP_AGENT_ID;
    delete process.env.ABADGE_MCP_PRIVATE_KEY_PATH;

    const config = loadConfig();

    expect(config).toEqual({
      apiUrl: "http://localhost:8787",
      authToken: "abl_legacy_token",
    });

    rmSync(home, { recursive: true, force: true });
  });
});

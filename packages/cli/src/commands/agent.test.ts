import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import {
  buildMcpConfigObject,
  buildMcpConfigSnippet,
  configSlotForKind,
  createAgentCommand,
  defaultMcpBinaryPath,
} from "./agent";

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

  test("buildMcpConfigObject returns the same structured shape as the parsed snippet", () => {
    const input = {
      agentId: "agent_abc123",
      apiUrl: "https://api.abadge.io",
      privateKeyPath: "/Users/punit/.abadge/agents/agent_abc123.ed25519.jwk",
      binaryPath: "/Users/punit/.abadge/bin/abadge-mcp",
    };
    expect(buildMcpConfigObject(input)).toEqual(JSON.parse(buildMcpConfigSnippet(input)));
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

describe("agent register action handler", () => {
  // Sentinel error thrown by the mocked process.exit so we can detect the
  // exit call without actually terminating the test runner.
  const EXIT_SENTINEL = "__test_process_exit__";

  test("rejects --mcp-config combined with --json before any I/O", async () => {
    let exitCode: number | undefined;
    const exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCode = code;
      throw new Error(EXIT_SENTINEL);
    }) as never);
    const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});

    try {
      const cmd = createAgentCommand();
      // The guard ordering in agent.ts means --kind local_mcp + --mcp-config +
      // --json trips the new --json rejection BEFORE the apiUrl/loadConfig
      // check, so we don't need to mock the local config or the API client.
      await expect(
        cmd.parseAsync(
          ["add", "--name", "test", "--kind", "local_mcp", "--mcp-config", "--json"],
          { from: "user" },
        ),
      ).rejects.toThrow(EXIT_SENTINEL);

      expect(exitCode).toBe(1);

      const errorOutput = consoleErrorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(errorOutput).toContain("--mcp-config cannot be combined with --json");
      // Verify the error message points users at the correct two-step pattern
      // so we don't regress the UX hint if someone refactors the message.
      expect(errorOutput).toContain("abadge agent mcp-config");
    } finally {
      exitSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// registerKeypairAgent — exported helper covering the keypair flow for
// `agent add`, with mocked SDK + filesystem. Legacy-API-key registration
// was removed in PR 4 (keypair-only registration).
// ---------------------------------------------------------------------------

describe("registerKeypairAgent (exported helper)", () => {
  const { mkdtempSync, readFileSync, rmSync } = require("node:fs") as typeof import("node:fs");
  const { tmpdir } = require("node:os") as typeof import("node:os");

  // Use a per-test HOME tmpdir so the helper writes to a sandbox.
  let HOME_DIR: string;
  let originalHome: string | undefined;
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;

  // Stub UserClient — only `createAgent` is exercised by the helpers.
  function makeStubClient(returns: unknown): {
    client: { createAgent: (...args: unknown[]) => Promise<unknown> };
    calls: unknown[];
  } {
    const calls: unknown[] = [];
    return {
      client: {
        createAgent: async (input: unknown) => {
          calls.push(input);
          if (returns instanceof Error) throw returns;
          return returns;
        },
      },
      calls,
    };
  }

  beforeEach(() => {
    HOME_DIR = mkdtempSync(join(tmpdir(), "abadge-agent-test-"));
    originalHome = process.env.HOME;
    process.env.HOME = HOME_DIR;
    // Seed a minimal config so updateConfig has an apiUrl to merge with —
    // production registerKeypair runs after `abadge login` so apiUrl is
    // always present.
    const cfgDir = join(HOME_DIR, ".abadge");
    require("node:fs").mkdirSync(cfgDir, { recursive: true, mode: 0o700 });
    require("node:fs").writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({ apiUrl: "http://localhost:8787" }),
      { mode: 0o600 },
    );
    logSpy = spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    rmSync(HOME_DIR, { recursive: true, force: true });
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test("registerKeypairAgent writes the JWK private key with mode 0600 and updates local config", async () => {
    const { registerKeypairAgent } = await import("./agent");
    const { client, calls } = makeStubClient({
      agent: { id: "agent_kp1", name: "deploy-bot" },
    });

    await registerKeypairAgent(client as never, {
      name: "deploy-bot",
      kind: "local_cli",
    });

    expect(calls).toHaveLength(1);
    const callArg = calls[0] as { name: string; kind: string; publicKey: string };
    expect(callArg.name).toBe("deploy-bot");
    expect(callArg.kind).toBe("local_cli");
    // The publicKey is a JSON-encoded JWK — should parse and have an `x` field.
    const parsedPub = JSON.parse(callArg.publicKey);
    expect(parsedPub.kty).toBe("OKP");
    expect(parsedPub.x).toBeTruthy();

    const keyPath = join(HOME_DIR, ".abadge", "agents", "agent_kp1.ed25519.jwk");
    const stat = require("node:fs").statSync(keyPath);
    // file mode 0o600 (owner rw only)
    expect(stat.mode & 0o777).toBe(0o600);
    const persisted = JSON.parse(readFileSync(keyPath, "utf-8"));
    expect(persisted.kty).toBe("OKP");
    expect(persisted.d).toBeTruthy(); // private exponent

    // Local config should now have a `localAgents.cli` slot pointing at the keyPath.
    const cfgPath = join(HOME_DIR, ".abadge", "config.json");
    // Pre-write a config so updateConfig has an apiUrl to merge with — the
    // production flow runs after `abadge login` so apiUrl is always present.
    // (Without it the second registerKeypairAgent below would try to create
    // a config without apiUrl. We verify the slot was written separately.)
    const persistedCfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
    expect(persistedCfg.localAgents.cli.agentId).toBe("agent_kp1");
    expect(persistedCfg.localAgents.cli.privateKeyPath).toBe(keyPath);
  });

  test("registerKeypairAgent --json prints the agent and key path as JSON, no extra log lines", async () => {
    const { registerKeypairAgent } = await import("./agent");
    const { client } = makeStubClient({ agent: { id: "agent_kp2", name: "json-bot" } });

    await registerKeypairAgent(client as never, {
      name: "json-bot",
      kind: "local_cli",
      json: true,
    });

    // Exactly one console.log call carrying the JSON payload.
    expect(logSpy).toHaveBeenCalledTimes(1);
    const printed = (logSpy.mock.calls[0]?.[0] ?? "") as string;
    const parsed = JSON.parse(printed);
    expect(parsed.agent.id).toBe("agent_kp2");
    expect(parsed.privateKeyPath).toMatch(/agent_kp2\.ed25519\.jwk$/);
  });

  test("registerKeypairAgent for a 'remote' kind warns (no local slot written)", async () => {
    const { registerKeypairAgent } = await import("./agent");
    const { client } = makeStubClient({ agent: { id: "agent_rem", name: "remote-bot" } });

    await registerKeypairAgent(client as never, {
      name: "remote-bot",
      kind: "remote",
    });

    // configSlotForKind("remote") = null → no localAgents update.
    const cfgPath = join(HOME_DIR, ".abadge", "config.json");
    const persistedCfg = JSON.parse(require("node:fs").readFileSync(cfgPath, "utf-8"));
    expect(persistedCfg.localAgents).toBeUndefined();
  });

  test("registerKeypairAgent surfaces SDK errors (createAgent throws)", async () => {
    const { registerKeypairAgent } = await import("./agent");
    const { client } = makeStubClient(new Error("403 cannot create agent"));

    await expect(
      registerKeypairAgent(client as never, {
        name: "fails",
        kind: "local_cli",
      }),
    ).rejects.toThrow(/403 cannot create agent/);
  });
});

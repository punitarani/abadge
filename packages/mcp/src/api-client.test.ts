/**
 * Unit coverage for getApiClient — caches AbadgeAgentClient by (apiUrl, agentId),
 * loads private keys from inline JWK strings or JWK files, and connects() lazily.
 *
 * Mocks @abadge/sdk's AbadgeAgentClient so the test never touches the network or
 * real Ed25519 crypto.
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface AgentClientArgs {
  apiUrl: string;
  agentId: string;
  privateKey: unknown;
}

const constructorCalls: AgentClientArgs[] = [];
const connectCalls: AgentClientArgs[] = [];

class FakeAgentClient {
  constructor(public readonly opts: AgentClientArgs) {
    constructorCalls.push(opts);
  }
  connect = async (): Promise<void> => {
    connectCalls.push(this.opts);
  };
}

const realSdk = await import("@abadge/sdk");

mock.module("@abadge/sdk", () => ({
  ...realSdk,
  AbadgeAgentClient: FakeAgentClient,
}));

const { getApiClient } = await import("./api-client");

let tmp: string;

beforeEach(() => {
  constructorCalls.length = 0;
  connectCalls.length = 0;
  tmp = mkdtempSync(join(tmpdir(), "abadge-mcp-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

afterAll(() => {
  // Re-install the real SDK so later test files (which may also import
  // @abadge/sdk) see the original AbadgeAgentClient. mock.module is
  // process-sticky; a real restore requires re-mocking.
  mock.module("@abadge/sdk", () => ({ ...realSdk }));
});

describe("getApiClient", () => {
  test("constructs once and reuses the cached client for the same key", async () => {
    const config = { apiUrl: "http://x", agentId: "agent_a", privateKey: '{"kty":"OKP"}' };

    const a = await getApiClient(config);
    const b = await getApiClient(config);
    expect(a).toBe(b);
    expect(constructorCalls).toHaveLength(1);
    expect(connectCalls).toHaveLength(1);
  });

  test("constructs a new client when apiUrl or agentId changes", async () => {
    // Use unique keys for this test so the module-level cache from earlier
    // tests doesn't satisfy the first call here.
    await getApiClient({
      apiUrl: "http://test2-1",
      agentId: "agent_a",
      privateKey: '{"kty":"OKP"}',
    });
    expect(constructorCalls).toHaveLength(1);
    await getApiClient({
      apiUrl: "http://test2-2",
      agentId: "agent_a",
      privateKey: '{"kty":"OKP"}',
    });
    expect(constructorCalls).toHaveLength(2);
    await getApiClient({
      apiUrl: "http://test2-2",
      agentId: "agent_b",
      privateKey: '{"kty":"OKP"}',
    });
    expect(constructorCalls).toHaveLength(3);
  });

  test("inline privateKey string is forwarded straight to the SDK", async () => {
    await getApiClient({
      apiUrl: "http://x",
      agentId: "agent_a",
      privateKey: '{"kty":"OKP","x":"abc"}',
    });
    expect(constructorCalls[0]?.privateKey).toBe('{"kty":"OKP","x":"abc"}');
  });

  test("file-based privateKeyPath is JSON-parsed and forwarded", async () => {
    const path = join(tmp, "key.jwk");
    writeFileSync(path, JSON.stringify({ kty: "OKP", x: "abc" }), { mode: 0o600 });
    await getApiClient({
      apiUrl: "http://x",
      agentId: "agent_b",
      privateKeyPath: path,
    });
    expect(constructorCalls[0]?.privateKey).toEqual({ kty: "OKP", x: "abc" });
  });

  test("rejects when neither privateKey nor privateKeyPath is configured", async () => {
    await expect(
      getApiClient({ apiUrl: "http://x", agentId: "agent_x" } as Parameters<
        typeof getApiClient
      >[0]),
    ).rejects.toThrow(/No private key configured/);
  });
});

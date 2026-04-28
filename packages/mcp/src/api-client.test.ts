/**
 * Unit coverage for getApiClient — caches AbadgeAgentClient by (apiUrl, agentId),
 * loads private keys from inline JWK strings or JWK files, and connects() lazily.
 *
 * Uses the `__setAgentClientFactoryForTests` seam (api-client.ts) instead of
 * `mock.module("@abadge/sdk")` because module mocks are process-sticky and
 * would corrupt unrelated SDK tests (e.g. sdk/resolve-private-key) that
 * construct a real AbadgeAgentClient.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  __resetAgentClientFactoryForTests,
  __setAgentClientFactoryForTests,
  getApiClient,
} from "./api-client";

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

let tmp: string;

beforeEach(() => {
  constructorCalls.length = 0;
  connectCalls.length = 0;
  tmp = mkdtempSync(join(tmpdir(), "abadge-mcp-"));
  // Re-install the factory + clear the module-level cache between tests.
  __setAgentClientFactoryForTests(
    (opts) =>
      // biome-ignore lint/suspicious/noExplicitAny: mock factory returns a structural fake
      new FakeAgentClient(opts) as any,
  );
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

afterAll(() => {
  __resetAgentClientFactoryForTests();
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

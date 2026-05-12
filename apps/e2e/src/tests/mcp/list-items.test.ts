/**
 * Spawn the real MCP stdio server (`bun packages/mcp/src/index.ts`) and
 * drive it over JSON-RPC. Verifies the keypair-backed
 * `AbadgeAgentClient.connect()` path works end-to-end against a live wrangler
 * API: challenge → Ed25519 sign → exchangeSession → tRPC tool calls.
 */
import { describe, expect, test } from "bun:test";
import { AbadgeUserClient } from "@abadge/sdk";
import { signupAndLogin } from "../../harness/auth";
import { startMcpClient } from "../../harness/mcp-client";
import { useTestStack } from "../../harness/test-stack";

const stack = useTestStack();

interface ListItemsResponse {
  items?: Array<{ id: string; label: string; storageMode: string }>;
}

async function buildAgentEnv(apiUrl: string): Promise<{
  apiUrl: string;
  agentId: string;
  privateKey: string;
  itemIds: string[];
}> {
  const owner = await signupAndLogin(apiUrl);
  const userClient = new AbadgeUserClient({ apiUrl, sessionToken: owner.sessionToken });
  const org = await userClient.createOrganization({
    name: "MCP",
    slug: `mcp-${crypto.randomUUID()}`,
  });
  const scoped = new AbadgeUserClient({
    apiUrl,
    sessionToken: owner.sessionToken,
    orgId: org.id,
  });
  // §REVAMP-PR3 Task 5.1 — default server_managed profile is auto-seeded.

  // Two items so list_items has to return something non-trivial
  const itemA = await scoped.createItem({
    storageMode: "server_managed",
    payload: {
      v: 1,
      label: "mcp-item-a",
      kind: "opaque",
      tags: [],
      fields: { value: "sk-a" },
    },
  });
  const itemB = await scoped.createItem({
    storageMode: "server_managed",
    payload: {
      v: 1,
      label: "mcp-item-b",
      kind: "opaque",
      tags: [],
      fields: { value: "sk-b" },
    },
  });

  const keypair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicJwk = await crypto.subtle.exportKey("jwk", keypair.publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", keypair.privateKey);

  const agent = await scoped.createAgent({
    name: "mcp-agent",
    kind: "local_mcp",
    authMethod: "public_key_session",
    publicKey: JSON.stringify(publicJwk),
  });

  // Grant reveal_plaintext on both items so they appear in listForAgent
  for (const itemId of [itemA.id, itemB.id]) {
    await scoped.createPermission({
      agentId: agent.agent.id,
      itemId,
      capabilities: ["reveal_plaintext"],
    });
  }

  return {
    apiUrl,
    agentId: agent.agent.id,
    privateKey: JSON.stringify(privateJwk),
    itemIds: [itemA.id, itemB.id],
  };
}

describe("mcp list_items", () => {
  test("returns the items the agent has permission for", async () => {
    const env = await buildAgentEnv(stack.apiUrl());
    const mcp = await startMcpClient(env);
    try {
      const resp = await mcp.callTool("list_items", {});
      expect(resp.isError).not.toBe(true);
      expect(resp.content[0]?.type).toBe("text");
      const text = resp.content[0]?.text ?? "";
      const parsed = JSON.parse(text) as ListItemsResponse;
      expect(parsed.items?.length).toBeGreaterThanOrEqual(2);
      const ids = (parsed.items ?? []).map((i) => i.id).sort();
      expect(ids).toEqual(env.itemIds.sort());
    } finally {
      await mcp.close();
    }
  }, 60_000);
});

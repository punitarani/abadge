/**
 * §RED1 over the wire: confirm the MCP `run_with_secret` response carries
 * exactly { exitCode, durationMs, outputLineCount, truncated } and never
 * leaks plaintext (or base64 of the secret) into the JSON returned to the
 * model. The same invariant is asserted at unit-test scope in
 * packages/mcp/src/tools/run-with-secret.test.ts; this test exercises the
 * stdio + real-API path.
 */
import { describe, expect, test } from "bun:test";
import { AbadgeUserClient } from "@abadge/sdk";
import { signupAndLogin } from "../../harness/auth";
import { startMcpClient } from "../../harness/mcp-client";
import { useTestStack } from "../../harness/test-stack";

const stack = useTestStack();

const SECRET_VALUE = "supersecret-deadbeef";

async function setup(): Promise<{
  apiUrl: string;
  agentId: string;
  privateKey: string;
  itemId: string;
}> {
  const apiUrl = stack.apiUrl();
  const owner = await signupAndLogin(apiUrl);
  const userClient = new AbadgeUserClient({ apiUrl, sessionToken: owner.sessionToken });
  const org = await userClient.createOrganization({
    name: "MCP RWS",
    slug: `mcp-rws-${crypto.randomUUID()}`,
  });
  const scoped = new AbadgeUserClient({
    apiUrl,
    sessionToken: owner.sessionToken,
    orgId: org.id,
  });
  // §REVAMP-PR3 Task 5.1 — default server_managed profile is auto-seeded.

  const item = await scoped.createItem({
    storageMode: "server_managed",
    payload: {
      v: 1,
      label: "mcp-rws-secret",
      kind: "opaque",
      tags: [],
      fields: { value: SECRET_VALUE },
    },
  });

  const keypair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicJwk = await crypto.subtle.exportKey("jwk", keypair.publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", keypair.privateKey);

  const agent = await scoped.createAgent({
    name: "mcp-rws-agent",
    kind: "local_mcp",
    authMethod: "public_key_session",
    publicKey: JSON.stringify(publicJwk),
  });

  await scoped.createPermission({
    agentId: agent.agent.id,
    itemId: item.id,
    capabilities: ["mount_env"],
  });

  return {
    apiUrl,
    agentId: agent.agent.id,
    privateKey: JSON.stringify(privateJwk),
    itemId: item.id,
  };
}

describe("mcp run_with_secret", () => {
  test("response has only the four §RED1 keys and never echoes the secret", async () => {
    const env = await setup();
    const mcp = await startMcpClient(env);

    try {
      const resp = await mcp.callTool("run_with_secret", {
        itemId: env.itemId,
        // Deliberately echo the secret to stdout — the response shape MUST
        // still be plaintext-free. Use bun (always present in the harness env).
        // biome-ignore lint/style/noRestrictedGlobals: test needs the running runtime's binary path
        command: process.execPath,
        args: ["-e", "process.stdout.write(process.env.ABADGE_SECRET ?? '')"],
        envVarName: "ABADGE_SECRET",
      });
      expect(resp.isError).not.toBe(true);
      const text = resp.content[0]?.text ?? "";
      const parsed = JSON.parse(text) as Record<string, unknown>;

      expect(Object.keys(parsed).sort()).toEqual([
        "durationMs",
        "exitCode",
        "outputLineCount",
        "truncated",
      ]);
      expect(parsed.exitCode).toBe(0);

      // Defense: the JSON string must contain neither the secret nor its
      // base64 form (a classic redaction bypass).
      expect(text).not.toContain(SECRET_VALUE);
      expect(text).not.toContain(Buffer.from(SECRET_VALUE).toString("base64"));
    } finally {
      await mcp.close();
    }
  }, 60_000);
});

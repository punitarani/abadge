/**
 * Cross-org isolation against the live API: an org-A caller that injects org-B's
 * agent or item IDs must be rejected with AGENT_NOT_FOUND / ITEM_NOT_FOUND
 * rather than leaking the existence of the other org's resources.
 */
import { describe, expect, test } from "bun:test";
import { AbadgeApiError, AbadgeUserClient } from "@abadge/sdk";
import { signupAndLogin } from "../../harness/auth";
import { useTestStack } from "../../harness/test-stack";

const stack = useTestStack();

async function setupOrg(apiUrl: string, sessionToken: string, label: string) {
  const userClient = new AbadgeUserClient({ apiUrl, sessionToken });
  const org = await userClient.orgs.create({
    name: `Org ${label}`,
    slug: `org-${label}-${crypto.randomUUID()}`,
  });
  const scoped = new AbadgeUserClient({ apiUrl, sessionToken, orgId: org.id });
  // Org creation already seeded the default server_managed profile.
  const item = await scoped.items.create({
    storageMode: "server_managed",
    payload: {
      v: 1,
      label: `secret-${label}`,
      kind: "opaque",
      tags: [],
      fields: { value: `sk-${label}` },
    },
  });
  const keypair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicJwk = await crypto.subtle.exportKey("jwk", keypair.publicKey);
  const agent = await scoped.agents.create({
    name: `agent-${label}`,
    kind: "remote",
    authMethod: "public_key_session",
    publicKey: JSON.stringify(publicJwk),
  });
  return { org, scoped, itemId: item.id, agentId: agent.agent.id };
}

describe("cross-org isolation", () => {
  test("permissions.create rejects cross-org agent and item ids", async () => {
    const apiUrl = stack.apiUrl();
    const owner = await signupAndLogin(apiUrl);
    const orgA = await setupOrg(apiUrl, owner.sessionToken, "a");
    const orgB = await setupOrg(apiUrl, owner.sessionToken, "b");

    // Inject orgB's agentId into an orgA call.
    let captured: AbadgeApiError | null = null;
    try {
      await orgA.scoped.permissions.create({
        agentId: orgB.agentId,
        itemId: orgA.itemId,
        capabilities: ["reveal_plaintext"],
      });
    } catch (err) {
      captured = err as AbadgeApiError;
    }
    expect(captured).toBeInstanceOf(AbadgeApiError);
    expect(captured?.code).toBe("AGENT_NOT_FOUND");

    // Inject orgB's itemId.
    captured = null;
    try {
      await orgA.scoped.permissions.create({
        agentId: orgA.agentId,
        itemId: orgB.itemId,
        capabilities: ["reveal_plaintext"],
      });
    } catch (err) {
      captured = err as AbadgeApiError;
    }
    expect(captured).toBeInstanceOf(AbadgeApiError);
    expect(captured?.code).toBe("ITEM_NOT_FOUND");
  }, 45_000);
});

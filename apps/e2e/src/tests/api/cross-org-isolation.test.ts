/**
 * Port of the cross-org assertions from scripts/e2e-multiperm.sh and
 * scripts/pentest-cross-profile.sh into TypeScript so they run in CI.
 * Hits the live API; verifies AGENT_NOT_FOUND / ITEM_NOT_FOUND when an
 * org-A caller injects org-B's IDs.
 */
import { describe, expect, test } from "bun:test";
import { AbadgeApiError, AbadgeUserClient } from "@abadge/sdk";
import { signupAndLogin } from "../../harness/auth";
import { useTestStack } from "../../harness/test-stack";

const stack = useTestStack();

async function setupOrg(apiUrl: string, sessionToken: string, label: string) {
  const userClient = new AbadgeUserClient({ apiUrl, sessionToken });
  const org = await userClient.createOrganization({
    name: `Org ${label}`,
    slug: `org-${label}-${crypto.randomUUID()}`,
  });
  const scoped = new AbadgeUserClient({ apiUrl, sessionToken, orgId: org.id });
  // §REVAMP-PR3 Task 5.1 — default server_managed profile is auto-seeded.
  const item = await scoped.createItem({
    storageMode: "server_managed",
    payload: {
      v: 1,
      label: `secret-${label}`,
      kind: "opaque",
      tags: [],
      fields: { value: `sk-${label}` },
    },
  });
  const agent = await scoped.createAgent({
    name: `agent-${label}`,
    kind: "remote",
    authMethod: "legacy_api_key",
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
      await orgA.scoped.createPermission({
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
      await orgA.scoped.createPermission({
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

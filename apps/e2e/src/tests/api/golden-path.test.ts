/**
 * End-to-end golden path through the real wire: HTTP → Hono → tRPC →
 * Better Auth → Drizzle → Postgres. Mirrors the in-process test at
 * packages/trpc/src/server/__tests__/e2e/golden-path.test.ts but pays the
 * full network + auth cost so the wire format and Hono envelopes are
 * verified end-to-end.
 */
import { describe, expect, test } from "bun:test";
import { AbadgeAgentClient, AbadgeUserClient } from "@abadge/sdk";
import { signupAndLogin } from "../../harness/auth";
import { useTestStack } from "../../harness/test-stack";

const stack = useTestStack();

describe("api golden path", () => {
  test("operator-to-agent secret access workflow over HTTP", async () => {
    const apiUrl = stack.apiUrl();

    // 1. signup + sign-in via Better Auth HTTP, get bearer
    const owner = await signupAndLogin(apiUrl);
    const orgUserClient = new AbadgeUserClient({
      apiUrl,
      sessionToken: owner.sessionToken,
    });

    // 2. create org (server seeds no profile — caller is responsible)
    const org = await orgUserClient.orgs.create({
      name: "E2E Org",
      slug: `e2e-${crypto.randomUUID()}`,
    });

    // From here on the client must send X-Abadge-Org-Id (the user is a
    // single-org member, but org-scoped procedures still require it).
    const userClient = new AbadgeUserClient({
      apiUrl,
      sessionToken: owner.sessionToken,
      orgId: org.id,
    });

    // 3. organizations.create auto-seeds a default server_managed profile
    // (§REVAMP-PR3 Task 5.1), so no explicit createProfile is needed here.

    // 4. create a server-managed item
    const { id: itemId } = await userClient.items.create({
      storageMode: "server_managed",
      payload: {
        v: 1,
        label: "prod-db-password",
        kind: "opaque",
        tags: ["database", "production"],
        fields: { password: "s3cret!", host: "db.acme.com" },
      },
    });

    // 5. create a remote agent with public_key_session auth (explicit-key path)
    const keypair = (await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const publicJwk = await crypto.subtle.exportKey("jwk", keypair.publicKey);
    const privateJwk = await crypto.subtle.exportKey("jwk", keypair.privateKey);

    const agent2 = await userClient.agents.create({
      name: "deploy-bot-2",
      kind: "remote",
      authMethod: "public_key_session",
      publicKey: JSON.stringify(publicJwk),
    });
    expect(agent2.agent.id).toBeDefined();

    // 6. grant reveal_plaintext
    const grant = await userClient.permissions.create({
      agentId: agent2.agent.id,
      itemId,
      capabilities: ["reveal_plaintext"],
    });
    expect(grant.permissions).toHaveLength(1);

    // 7. agent-side: keypair session exchange via real HTTP
    const agentClient = new AbadgeAgentClient({
      apiUrl,
      agentId: agent2.agent.id,
      privateKey: JSON.stringify(privateJwk),
    });
    await agentClient.connect();

    try {
      // 8. agent reveals the item
      const reveal = await agentClient.access.read(itemId);
      if (reveal.storageMode !== "server_managed") throw new Error("Expected server_managed item");
      expect(reveal.payload.fields.password).toBe("s3cret!");
      expect(reveal.payload.fields.host).toBe("db.acme.com");

      // 9. audit trail records the allowed access
      const audit = await userClient.audit.list({
        itemId,
        eventType: "access.reveal",
        result: "allowed",
      });
      expect(audit.entries.length).toBeGreaterThanOrEqual(1);
      const allowed = audit.entries.find(
        (e) => e.eventType === "access.reveal" && e.result === "allowed",
      );
      expect(allowed?.agentId).toBe(agent2.agent.id);
      expect(allowed?.itemId).toBe(itemId);
    } finally {
      agentClient.disconnect();
    }
  }, 60_000);
});

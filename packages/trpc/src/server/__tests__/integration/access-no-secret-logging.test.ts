import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import {
  seedAgent,
  seedAgentSession,
  seedOrg,
  seedPermission,
  seedServerItem,
  seedUser,
} from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createAgentCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

const SENTINEL = "PLAINTEXT-SENTINEL-9f8e7d6c5b4a";

/**
 * §AB-0091 — regression guard: the server-side reveal path decrypts plaintext,
 * so a future debug log in that path could leak it to Workers observability.
 * Capture all console output during an agent reveal and assert the known
 * plaintext never appears. Fails loudly if anyone adds a logging statement
 * that prints decrypted payloads.
 */
describe("no secret plaintext in logs (AB-0091)", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("an agent reveal never writes the decrypted plaintext to any console method", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const item = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      fields: { password: SENTINEL },
    });
    const agent = await seedAgent(db, { userId: owner.userId, orgId: org.orgId, kind: "remote" });
    await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId: item.itemId,
      capability: "reveal_plaintext",
      grantedBy: owner.userId,
    });
    const session = await seedAgentSession(db, { agentId: agent.agentId, userId: owner.userId });
    const caller = createAgentCaller(db, auth, session.rawToken);

    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      spyOn(console, m).mockImplementation(() => {}),
    );
    let revealed: string | undefined;
    try {
      const result = await caller.access.read({ itemId: item.itemId });
      revealed = (result as { payload?: { fields?: Record<string, string> } }).payload?.fields
        ?.password;
    } finally {
      const output = spies
        .flatMap((s) => s.mock.calls.flat())
        .map(String)
        .join("\n");
      for (const s of spies) s.mockRestore();
      // Sanity: the reveal actually returned the sentinel (the test is meaningful).
      expect(revealed).toBe(SENTINEL);
      // The guard: that plaintext must never have hit any console method.
      expect(output).not.toContain(SENTINEL);
    }
  });
});

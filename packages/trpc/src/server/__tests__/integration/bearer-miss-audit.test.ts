import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { desc, eq } from "@abadge/db";
import { auditLogs } from "@abadge/db/schema";
import { Effect } from "effect";
import { resolveAgentIdentity, shouldWriteUnauthBearerAudit } from "../../auth";
import type { AppBindings, BaseRequestContext } from "../../context";
import { createTestAuth } from "../helpers/test-auth";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";
import { TEST_ENV } from "../helpers/test-env";

function createAgentCtx(
  db: ReturnType<typeof getTestDb>,
  auth: ReturnType<typeof createTestAuth>,
  rawToken: string,
  ipAddress: string,
): BaseRequestContext {
  const headers = new Headers();
  headers.set("authorization", `Bearer ${rawToken}`);
  return {
    req: new Request("http://test", { headers }),
    resHeaders: new Headers(),
    env: { ...TEST_ENV } as AppBindings,
    validatedEnv: TEST_ENV,
    db,
    auth,
    ipAddress,
  };
}

describe("unrecognized bearer audit (W2T12-001)", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("garbage bearer (no abs_ prefix) writes an audit row with reason=unknown_credential", async () => {
    const ip = `192.168.1.1`;
    const ctx = createAgentCtx(db, auth, "garbagetoken1234", ip);

    const exit = await Effect.runPromiseExit(resolveAgentIdentity(ctx));
    expect(exit._tag).toBe("Failure");

    const [row] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.eventType, "agent.session_reject"))
      .orderBy(desc(auditLogs.occurredAt))
      .limit(1);

    expect(row).toBeDefined();
    expect(row?.result).toBe("denied");
    expect((row?.meta as { reason?: string } | null)?.reason).toBe("unknown_credential");
    // Token starts with "garb" — first 4 chars
    expect((row?.meta as { tokenPrefix?: string } | null)?.tokenPrefix).toBe("garb");
    expect(row?.organizationId).toBe("__unauth__");
    expect(row?.userId).toBe("__unauth__");
    expect(row?.agentId).toBeNull();
  });

  test("abs_-prefixed bearer (session prefix, no matching row) writes an audit row", async () => {
    const ip = `192.168.2.1`;
    // Use the real abs_ prefix so the probe goes through verifyAgentSessionIdentity.
    const fakeSessionToken = "abs_veryfakegarbagetoken9999";
    const ctx = createAgentCtx(db, auth, fakeSessionToken, ip);

    const exit = await Effect.runPromiseExit(resolveAgentIdentity(ctx));
    expect(exit._tag).toBe("Failure");

    const [row] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.eventType, "agent.session_reject"))
      .orderBy(desc(auditLogs.occurredAt))
      .limit(1);

    expect(row).toBeDefined();
    expect(row?.result).toBe("denied");
    expect((row?.meta as { reason?: string } | null)?.reason).toBe("unknown_credential");
    // Token starts with "abs_"
    expect((row?.meta as { tokenPrefix?: string } | null)?.tokenPrefix).toBe("abs_");
    expect(row?.organizationId).toBe("__unauth__");
    expect(row?.userId).toBe("__unauth__");
  });

  test("rate-limited per IP: 11 probes from same IP write at most 1 audit row in 10s window", async () => {
    const ip = `192.168.3.1`;

    for (let i = 0; i < 11; i++) {
      const ctx = createAgentCtx(db, auth, `garbagetoken${i}`, ip);
      await Effect.runPromiseExit(resolveAgentIdentity(ctx));
    }

    const rows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.eventType, "agent.session_reject"));

    expect(rows.length).toBeLessThanOrEqual(1);
    expect(rows.length).toBe(1);
  });

  test("shouldWriteUnauthBearerAudit: distinct IPs each get their own window", () => {
    const ip1 = `10.0.0.1`;
    const ip2 = `10.0.0.2`;

    // First call per IP should always return true
    expect(shouldWriteUnauthBearerAudit(ip1)).toBe(true);
    expect(shouldWriteUnauthBearerAudit(ip2)).toBe(true);

    // Second call within window should return false for each
    expect(shouldWriteUnauthBearerAudit(ip1)).toBe(false);
    expect(shouldWriteUnauthBearerAudit(ip2)).toBe(false);
  });
});

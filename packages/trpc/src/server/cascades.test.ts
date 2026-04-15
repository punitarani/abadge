import { describe, expect, test } from "bun:test";
import { onAgentRevoked, onItemDeleted } from "./cascades";

type MockCall = { op: string; args?: unknown[] };

/**
 * Creates a minimal Drizzle-like chainable mock.
 * - `select().from().where()` resolves to `selectResult` (thenable at the where step).
 * - `update().set().where()` resolves to undefined.
 * - `insert().values()` resolves to { rowCount: 1 }.
 */
function makeMockDb(selectResult: unknown[] = []) {
  const calls: MockCall[] = [];
  let inSelect = false;

  // biome-ignore lint/suspicious/noExplicitAny: test mock
  const chain: any = {};

  chain.select = (...args: unknown[]) => {
    inSelect = true;
    calls.push({ op: "select", args });
    return chain;
  };

  chain.from = (...args: unknown[]) => {
    calls.push({ op: "from", args });
    return chain;
  };

  chain.where = (...args: unknown[]) => {
    calls.push({ op: "where", args });
    if (inSelect) {
      inSelect = false;
      // Return a Promise so that `await db.select().from().where(...)` resolves to selectResult.
      return Promise.resolve(selectResult);
    }
    return Promise.resolve(undefined);
  };

  chain.update = (...args: unknown[]) => {
    inSelect = false;
    calls.push({ op: "update", args });
    return chain;
  };

  chain.set = (...args: unknown[]) => {
    calls.push({ op: "set", args });
    return chain;
  };

  chain.delete = (...args: unknown[]) => {
    calls.push({ op: "delete", args });
    return chain;
  };

  chain.insert = (...args: unknown[]) => {
    calls.push({ op: "insert", args });
    return chain;
  };

  chain.values = (...args: unknown[]) => {
    calls.push({ op: "values", args });
    return Promise.resolve({ rowCount: 1 });
  };

  return {
    db: chain as Parameters<typeof onAgentRevoked>[0],
    calls,
  };
}

describe("onAgentRevoked", () => {
  test("does nothing when there are no active sessions", async () => {
    const { db, calls } = makeMockDb([]); // no active sessions
    await onAgentRevoked(db, "agent-1", "org-1", "user-1");

    const updateOps = calls.filter((c) => c.op === "update");
    const insertOps = calls.filter((c) => c.op === "insert");

    expect(updateOps.length).toBe(0);
    expect(insertOps.length).toBe(0);
  });

  test("revokes all active sessions and writes one audit entry per session", async () => {
    const { db, calls } = makeMockDb([
      { id: "session-1", userId: "user-2" },
      { id: "session-2", userId: "user-2" },
    ]);

    await onAgentRevoked(db, "agent-1", "org-1", "user-1");

    const updateOps = calls.filter((c) => c.op === "update");
    const insertOps = calls.filter((c) => c.op === "insert");
    const valueOps = calls.filter((c) => c.op === "values");

    // 2 sessions → 2 update + 2 insert (one pair per session)
    expect(updateOps.length).toBe(2);
    expect(insertOps.length).toBe(2);
    expect(valueOps.length).toBe(2);

    // ipAddress defaults to null when not provided
    for (const valueOp of valueOps) {
      const payload = (valueOp?.args?.[0] ?? {}) as Record<string, unknown>;
      expect(payload.ipAddress).toBeNull();
    }
  });

  test("threads ipAddress into each cascade audit entry", async () => {
    const { db, calls } = makeMockDb([
      { id: "session-1", userId: "user-2" },
      { id: "session-2", userId: "user-2" },
    ]);

    await onAgentRevoked(db, "agent-1", "org-1", "user-1", "203.0.113.1");

    const valueOps = calls.filter((c) => c.op === "values");
    expect(valueOps.length).toBe(2);

    for (const valueOp of valueOps) {
      const payload = (valueOp?.args?.[0] ?? {}) as Record<string, unknown>;
      expect(payload.ipAddress).toBe("203.0.113.1");
    }
  });
});

describe("onItemDeleted", () => {
  test("cleans up permissions and writes a cascade audit entry", async () => {
    const { db, calls } = makeMockDb();
    await onItemDeleted(db, "item-1", "org-1", "user-1");

    const deleteOps = calls.filter((c) => c.op === "delete");
    expect(deleteOps.length).toBe(1);

    const valueOps = calls.filter((c) => c.op === "values");
    expect(valueOps.length).toBe(1);

    const payload = (valueOps[0]?.args?.[0] ?? {}) as Record<string, unknown>;
    expect(payload.itemId).toBe("item-1");
    expect(payload.result).toBe("cascade");
    expect(payload.eventType).toBe("item.delete_cascade");

    // ipAddress defaults to null when not provided
    expect(payload.ipAddress).toBeNull();
  });

  test("threads ipAddress into the cascade audit entry", async () => {
    const { db, calls } = makeMockDb();
    await onItemDeleted(db, "item-1", "org-1", "user-1", "203.0.113.1");

    const valueOps = calls.filter((c) => c.op === "values");
    expect(valueOps.length).toBe(1);

    const payload = (valueOps[0]?.args?.[0] ?? {}) as Record<string, unknown>;
    expect(payload.ipAddress).toBe("203.0.113.1");
  });
});

// onMemberRemoved exercises real transactions and multiple-table queries,
// so it is covered by the integration suite in __tests__/integration/cascades.test.ts.

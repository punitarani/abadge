import { describe, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import { logBaseAudit } from "./audit";
import type { BaseRequestContext } from "./context";
import { BaseRequestContextTag } from "./effect";

// Minimal mock that satisfies the db.insert(...).values(...) call shape.
function makeMockCtx(insertValues: () => Promise<unknown>): BaseRequestContext {
  const db = {
    insert: () => ({
      values: insertValues,
    }),
  };
  return { db } as unknown as BaseRequestContext;
}

describe("log*Audit audit-write failures don't invert caller (W2T12-002)", () => {
  test("DB insert failure: caller still succeeds, warning logged", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const ctx = makeMockCtx(() => Promise.reject(new Error("simulated DB failure")));

    const program = logBaseAudit({
      organizationId: "org_123",
      userId: "user_456",
      eventType: "item.read",
      result: "allowed",
    }).pipe(Effect.provideService(BaseRequestContextTag, ctx));

    // Must resolve (not reject) even when the DB insert rejects.
    await expect(Effect.runPromise(program)).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warnArg: string = warnSpy.mock.calls[0]?.[0] as string;
    expect(warnArg).toContain("audit_write_failed");
    expect(warnArg).toContain("simulated DB failure");
    expect(warnArg).toContain("item.read");
    expect(warnArg).toContain("org_123");
    expect(warnArg).toContain("user_456");

    warnSpy.mockRestore();
  });

  test("DB insert success: no warning, no throw", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const ctx = makeMockCtx(() => Promise.resolve());

    const program = logBaseAudit({
      organizationId: "org_123",
      userId: "user_456",
      eventType: "item.read",
      result: "allowed",
    }).pipe(Effect.provideService(BaseRequestContextTag, ctx));

    await expect(Effect.runPromise(program)).resolves.toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});

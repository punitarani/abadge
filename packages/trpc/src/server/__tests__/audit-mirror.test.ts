import { describe, expect, test } from "bun:test";
import { buildAuditRow, mirrorAuditRow } from "../audit";

/**
 * The second audit sink is a best-effort structured-log emit. These tests pin
 * its load-bearing properties: it produces a parseable, marked line (so the
 * divergence check can find it); it never throws (so a sink failure can't block
 * the caller's request); and it redacts secret-bearing keys before emitting.
 */
describe("mirrorAuditRow (second audit sink)", () => {
  function captureLog(fn: () => void): string[] {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(String(args[0]));
    };
    try {
      fn();
    } finally {
      console.log = original;
    }
    return lines;
  }

  test("emits one marked, structured JSON line carrying the committed row", () => {
    const row = buildAuditRow({
      organizationId: "org_1",
      userId: "user_1",
      agentId: "agt_1",
      itemId: "itm_1",
      eventType: "access.reveal",
      result: "allowed",
    });

    const lines = captureLog(() => mirrorAuditRow(row));

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] as string);
    expect(parsed.audit_mirror).toBe(1);
    expect(parsed.organizationId).toBe("org_1");
    expect(parsed.agentId).toBe("agt_1");
    expect(parsed.itemId).toBe("itm_1");
    expect(parsed.eventType).toBe("access.reveal");
    expect(parsed.result).toBe("allowed");
    expect(typeof parsed.mirroredAt).toBe("string");
  });

  test("never throws when the log stream fails (best-effort)", () => {
    const row = buildAuditRow({
      organizationId: "org_1",
      userId: "user_1",
      eventType: "agent.session_reject",
      result: "denied",
    });

    const original = console.log;
    console.log = () => {
      throw new Error("log stream unavailable");
    };
    try {
      expect(() => mirrorAuditRow(row)).not.toThrow();
    } finally {
      console.log = original;
    }
  });

  test("redacts secret-bearing keys in meta before emitting", () => {
    const row = buildAuditRow({
      organizationId: "org_1",
      userId: "user_1",
      eventType: "access.reveal",
      result: "allowed",
      meta: { password: "topsecret-value" },
    });

    const lines = captureLog(() => mirrorAuditRow(row));

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("topsecret-value");
    expect(lines[0]).toContain("[redacted]");
  });
});

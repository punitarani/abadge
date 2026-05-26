import { describe, expect, test } from "bun:test";
import { buildAuditRow, mirrorAuditRow } from "../audit";

/**
 * §AB-0024 — the second audit sink is a best-effort structured-log emit. These
 * unit tests pin its two load-bearing properties: it produces a parseable,
 * marked line (so Logpush + the divergence check can find it), and it never
 * throws (so sink failure can't block a request — acceptance criterion 3).
 */
describe("mirrorAuditRow (§AB-0024 second audit sink)", () => {
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

  test("never throws when the log stream fails (best-effort, criterion 3)", () => {
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
});

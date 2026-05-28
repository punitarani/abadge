import { describe, expect, test } from "bun:test";
import {
  type AuditIdentity,
  findDivergences,
  identityKey,
  parseSinkKeys,
} from "./audit-divergence";

const blank: AuditIdentity = {
  organizationId: null,
  userId: null,
  agentId: null,
  itemId: null,
  profileId: null,
  eventType: null,
  result: null,
  deliveryMode: null,
  field: null,
};

describe("parseSinkKeys", () => {
  test("warns and skips malformed lines without aborting the scan", () => {
    const content = [
      JSON.stringify({ audit_mirror: 1, organizationId: "org_1", eventType: "access.reveal" }),
      "{ not valid json",
      JSON.stringify({ audit_mirror: 1, organizationId: "org_2", eventType: "access.reveal" }),
    ].join("\n");

    const errors: string[] = [];
    const original = console.error;
    console.error = (msg?: unknown) => {
      errors.push(String(msg));
    };
    let keys: string[];
    try {
      keys = parseSinkKeys(content);
    } finally {
      console.error = original;
    }

    // The valid rows on either side of the malformed line are still parsed.
    expect(keys).toHaveLength(2);
    expect(errors.some((e) => e.includes("malformed JSON on line 2"))).toBe(true);
  });

  test("ignores blank lines and objects without an audit_mirror marker", () => {
    const content = [
      "",
      JSON.stringify({ organizationId: "org_1", eventType: "access.reveal" }),
      JSON.stringify({ audit_mirror: 1, organizationId: "org_1", eventType: "access.reveal" }),
    ].join("\n");

    expect(parseSinkKeys(content)).toHaveLength(1);
  });
});

describe("identityKey", () => {
  test("is collision-safe when a field value contains the legacy '|' separator", () => {
    const a = identityKey({ ...blank, organizationId: "x|y", userId: "z" });
    const b = identityKey({ ...blank, organizationId: "x", userId: "y|z" });
    expect(a).not.toBe(b);
  });

  test("keeps null distinct from the empty string", () => {
    const withNull = identityKey({ ...blank, field: null });
    const withEmpty = identityKey({ ...blank, field: "" });
    expect(withNull).not.toBe(withEmpty);
  });
});

describe("findDivergences", () => {
  test("flags a sink event that is absent from the DB (the tamper signal)", () => {
    expect(findDivergences(["a", "a", "b"], ["a", "a", "b", "b"])).toEqual([
      { key: "b", deficit: 1 },
    ]);
  });

  test("reports nothing when the DB contains every sink event", () => {
    expect(findDivergences(["a", "b"], ["a", "b"])).toEqual([]);
    // A DB superset (extra rows the best-effort sink never received) is benign.
    expect(findDivergences(["a", "b", "c"], ["a"])).toEqual([]);
  });
});

import { describe, expect, test } from "bun:test";
import { buildAuditFilters } from "./audit";

describe("buildAuditFilters", () => {
  test("passes the filter flags straight through to the query", () => {
    const filters = buildAuditFilters({
      limit: "25",
      cursor: "100",
      result: "denied",
      agentId: "agent_1",
      itemId: "item_1",
      eventType: "access.reveal",
    });
    expect(filters).toEqual({
      limit: 25,
      cursor: "100",
      result: "denied",
      agentId: "agent_1",
      itemId: "item_1",
      eventType: "access.reveal",
    });
  });

  test("omitted flags resolve to undefined (no filter applied)", () => {
    const filters = buildAuditFilters({});
    expect(filters.limit).toBeUndefined();
    expect(filters.cursor).toBeUndefined();
    expect(filters.result).toBeUndefined();
    expect(filters.agentId).toBeUndefined();
    expect(filters.itemId).toBeUndefined();
    expect(filters.eventType).toBeUndefined();
  });

  test("non-numeric --limit collapses to undefined rather than NaN", () => {
    expect(buildAuditFilters({ limit: "abc" }).limit).toBeUndefined();
  });
});

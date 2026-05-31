/**
 * Unit tests for the shared item-form helpers powering both the create and
 * edit panels.
 */

import { describe, expect, test } from "bun:test";
import type { ItemPayload } from "@abadge/core";
import { buildFieldsForKind, payloadToFieldValues } from "./item-form-fields";

describe("buildFieldsForKind", () => {
  test("drops empty/whitespace values and the JSON tracking key", () => {
    const result = buildFieldsForKind("json", {
      kept: "value",
      blank: "",
      spaces: "   ",
      __json_next_id: "3",
    });
    expect(result).toEqual({ kept: "value" });
  });

  test("preserves non-empty values verbatim", () => {
    const result = buildFieldsForKind("api_key", { api_key: "sk-123" });
    expect(result).toEqual({ api_key: "sk-123" });
  });
});

describe("payloadToFieldValues", () => {
  test("maps string fields straight through", () => {
    const payload = { v: 1, kind: "api_key", fields: { api_key: "sk-123" } } as ItemPayload;
    expect(payloadToFieldValues(payload)).toEqual({ api_key: "sk-123" });
  });

  test("serializes non-string field values so the editor can round-trip them", () => {
    const payload = {
      v: 1,
      kind: "json",
      fields: { nested: { a: 1 }, count: 7 },
    } as unknown as ItemPayload;
    expect(payloadToFieldValues(payload)).toEqual({
      nested: JSON.stringify({ a: 1 }),
      count: "7",
    });
  });

  test("skips null/undefined fields and tolerates a missing fields map", () => {
    const payload = {
      v: 1,
      kind: "opaque",
      fields: { real: "x", gone: null },
    } as unknown as ItemPayload;
    expect(payloadToFieldValues(payload)).toEqual({ real: "x" });
    expect(payloadToFieldValues({ v: 1, kind: "opaque" } as unknown as ItemPayload)).toEqual({});
  });
});

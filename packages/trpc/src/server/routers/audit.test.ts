import { describe, expect, test } from "bun:test";
import { Either, Schema } from "effect";
import { strictSchema } from "../effect";
import { getAuditEventTypeFilters, normalizeAuditEventType } from "../serialize";
import { AuditQueryInputSchema } from "./audit";

const decodeAuditQuery = Schema.decodeUnknownEither(strictSchema(AuditQueryInputSchema));

describe("audit query compatibility", () => {
  test("accepts legacy audit event filters during input validation", () => {
    const result = decodeAuditQuery({ eventType: "grant.create" });

    expect(Either.isRight(result)).toBe(true);
  });

  test("rejects unknown audit event filters", () => {
    const result = decodeAuditQuery({ eventType: "not-a-real-event" });

    expect(Either.isLeft(result)).toBe(true);
  });

  test("normalizes legacy audit event filters to permission event names", () => {
    expect(normalizeAuditEventType("grant.create")).toBe("permission.create");
    expect(getAuditEventTypeFilters("grant.create")).toEqual(["permission.create", "grant.create"]);
  });

  test("throws for unexpected audit event types", () => {
    expect(() => normalizeAuditEventType("unexpected.event")).toThrow(
      "Unknown audit event type: unexpected.event",
    );
  });
});

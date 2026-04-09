import {
  AUDIT_EVENT_TYPES,
  AuditListResultSchema,
  type AuditQuery,
  AuditResultSchema,
} from "@abadge/core";
import { and, desc, eq, lt, or, type SQL } from "@abadge/db";
import { auditLog } from "@abadge/db/schema";
import { Effect, Schema } from "effect";
import { runSessionEffect, SessionRequestContextTag, strictSchema } from "../effect";
import { createTrpcRouter, scopedSessionProcedure } from "../init";
import {
  getAuditEventTypeFilters,
  LEGACY_AUDIT_EVENT_TYPES,
  normalizeAuditEventType,
  serializeAuditEntry,
} from "../serialize";

const AUDIT_EVENT_TYPE_FILTERS = [...AUDIT_EVENT_TYPES, ...LEGACY_AUDIT_EVENT_TYPES] as const;

export const AuditQueryInputSchema = Schema.Struct({
  eventType: Schema.optional(Schema.Literal(...AUDIT_EVENT_TYPE_FILTERS)),
  result: Schema.optional(AuditResultSchema),
  agentId: Schema.optional(Schema.String),
  itemId: Schema.optional(Schema.String),
  cursor: Schema.optional(
    Schema.String.pipe(
      Schema.pattern(/^\d+$/, { message: () => "cursor must be a numeric string" }),
    ),
  ),
  limit: Schema.optional(
    Schema.Int.pipe(Schema.greaterThanOrEqualTo(1), Schema.lessThanOrEqualTo(100)),
  ),
});

function normalizeAuditQuery(input: Schema.Schema.Type<typeof AuditQueryInputSchema>): AuditQuery {
  const eventType = input.eventType ? normalizeAuditEventType(input.eventType) : undefined;

  return {
    agentId: input.agentId,
    itemId: input.itemId,
    eventType,
    result: input.result,
    cursor: input.cursor,
    limit: input.limit,
  };
}

function buildEventTypeCondition(eventType: NonNullable<AuditQuery["eventType"]>): SQL {
  const eventTypes = getAuditEventTypeFilters(eventType);
  const [firstEventType, ...remainingEventTypes] = eventTypes;

  if (!firstEventType) {
    throw new Error(`No audit event filters available for ${eventType}`);
  }

  if (remainingEventTypes.length === 0) {
    return eq(auditLog.eventType, firstEventType);
  }

  const condition = or(
    eq(auditLog.eventType, firstEventType),
    ...remainingEventTypes.map((candidate) => eq(auditLog.eventType, candidate)),
  );

  if (!condition) {
    throw new Error(`Failed to build audit event filter for ${eventType}`);
  }

  return condition;
}

function buildAuditConditions(input: AuditQuery, userId: string): SQL[] {
  const conditions: SQL[] = [eq(auditLog.userId, userId)];

  if (input.eventType) conditions.push(buildEventTypeCondition(input.eventType));
  if (input.result) conditions.push(eq(auditLog.result, input.result));
  if (input.agentId) conditions.push(eq(auditLog.principalId, input.agentId));
  if (input.itemId) conditions.push(eq(auditLog.itemId, input.itemId));
  if (input.cursor) conditions.push(lt(auditLog.id, Number(input.cursor)));

  return conditions;
}

const listAuditEntries = (input: AuditQuery) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const conditions = buildAuditConditions(input, ctx.identity.userId);

    const limit = input.limit ?? 50;
    const result = yield* Effect.tryPromise(() =>
      ctx.db
        .select()
        .from(auditLog)
        .where(and(...conditions))
        .orderBy(desc(auditLog.id))
        .limit(limit),
    );

    const entries = result.map(serializeAuditEntry);
    const lastEntry = entries[entries.length - 1];
    const nextCursor = entries.length === limit && lastEntry ? String(lastEntry.id) : null;

    return { entries, nextCursor };
  });

export const auditRouter = createTrpcRouter({
  list: scopedSessionProcedure("audit:read")
    .input(strictSchema(AuditQueryInputSchema))
    .output(strictSchema(AuditListResultSchema))
    .query(({ ctx, input }) => runSessionEffect(ctx, listAuditEntries(normalizeAuditQuery(input)))),
});

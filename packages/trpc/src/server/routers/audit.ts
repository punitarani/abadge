import {
  AUDIT_EVENT_TYPES,
  AuditListResultSchema,
  type AuditQuery,
  AuditResultSchema,
} from "@abadge/core";
import { and, desc, eq, lt, or, type SQL } from "@abadge/db";
import { auditLogs } from "@abadge/db/schema";
import { Effect, Schema } from "effect";
import { runSessionEffect, SessionRequestContextTag, strictSchema } from "../effect";
import { createTrpcRouter, requireOrgRole, roleRank, scopedSessionProcedure } from "../init";
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
  profileId: Schema.optional(Schema.String),
  surface: Schema.optional(Schema.String),
  field: Schema.optional(Schema.String),
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
    return eq(auditLogs.eventType, firstEventType);
  }

  const condition = or(
    eq(auditLogs.eventType, firstEventType),
    ...remainingEventTypes.map((candidate) => eq(auditLogs.eventType, candidate)),
  );

  if (!condition) {
    throw new Error(`Failed to build audit event filter for ${eventType}`);
  }

  return condition;
}

interface AuditConditionsContext {
  orgId: string;
  userId: string;
  role: string;
  profileId?: string;
  surface?: string;
  field?: string;
}

function buildAuditConditions(input: AuditQuery, ctx: AuditConditionsContext): SQL[] {
  const conditions: SQL[] = [eq(auditLogs.organizationId, ctx.orgId)];

  // Non-admin users can only see their own audit entries
  if (roleRank(ctx.role) < roleRank("admin")) {
    conditions.push(eq(auditLogs.userId, ctx.userId));
  }

  if (input.eventType) conditions.push(buildEventTypeCondition(input.eventType));
  if (input.result) conditions.push(eq(auditLogs.result, input.result));
  if (input.agentId) conditions.push(eq(auditLogs.agentId, input.agentId));
  if (input.itemId) conditions.push(eq(auditLogs.itemId, input.itemId));
  if (ctx.profileId) conditions.push(eq(auditLogs.profileId, ctx.profileId));
  if (ctx.surface) conditions.push(eq(auditLogs.surface, ctx.surface));
  if (ctx.field) conditions.push(eq(auditLogs.field, ctx.field));
  if (input.cursor) conditions.push(lt(auditLogs.id, Number(input.cursor)));

  return conditions;
}

const listAuditEntries = (
  input: AuditQuery,
  extra: { profileId?: string; surface?: string; field?: string },
) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const role = yield* Effect.tryPromise(() =>
      requireOrgRole(ctx.db, ctx.identity.organizationId, ctx.identity.userId, "member"),
    );
    const conditions = buildAuditConditions(input, {
      orgId: ctx.identity.organizationId,
      userId: ctx.identity.userId,
      role,
      profileId: extra.profileId,
      surface: extra.surface,
      field: extra.field,
    });

    const limit = input.limit ?? 50;
    const result = yield* Effect.tryPromise(() =>
      ctx.db
        .select()
        .from(auditLogs)
        .where(and(...conditions))
        .orderBy(desc(auditLogs.id))
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
    .query(({ ctx, input }) =>
      runSessionEffect(
        ctx,
        listAuditEntries(normalizeAuditQuery(input), {
          profileId: input.profileId,
          surface: input.surface,
          field: input.field,
        }),
      ),
    ),
});

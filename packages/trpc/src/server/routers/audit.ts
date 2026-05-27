import {
  AUDIT_EVENT_TYPES,
  AuditListResultSchema,
  type AuditQuery,
  AuditResultSchema,
} from "@abadge/core";
import { and, desc, eq, isNull, lt, or, type SQL } from "@abadge/db";
import { Effect, Schema } from "effect";
import {
  AgentRequestContextTag,
  runAgentEffect,
  runSessionEffect,
  SessionRequestContextTag,
  strictSchema,
  tryAsync,
} from "../effect";
import {
  agentProcedure,
  createTrpcRouter,
  requireOrgRole,
  roleRank,
  scopedSessionProcedure,
} from "../init";
import { type ScopedDb, scopedDb } from "../scoped-db";
import {
  getAuditEventTypeFilters,
  LEGACY_AUDIT_EVENT_TYPES,
  normalizeAuditEventType,
  serializeAuditEntry,
} from "../serialize";

/** The `auditLogs` tenant table object, threaded into module-level helpers so
 * they reference columns through the org scope instead of a direct schema
 * import (§AB-0010). */
type AuditLogsTable = ScopedDb["tables"]["auditLogs"];

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

function buildEventTypeCondition(
  eventType: NonNullable<AuditQuery["eventType"]>,
  auditLogs: AuditLogsTable,
): SQL {
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
  // §AB-0043 — null when the caller is an orphaned agent (no owning user).
  userId: string | null;
  role: string;
  profileId?: string;
  surface?: string;
  field?: string;
}

function buildAuditConditions(
  input: AuditQuery,
  ctx: AuditConditionsContext,
  auditLogs: AuditLogsTable,
): SQL[] {
  const conditions: SQL[] = [eq(auditLogs.organizationId, ctx.orgId)];

  // Non-admin users can only see their own audit entries
  if (roleRank(ctx.role) < roleRank("admin")) {
    // §AB-0043 — an orphaned agent (userId null) sees the org's ownerless audit rows
    // (its own bucket); `eq(userId, null)` matches nothing under SQL NULL semantics.
    conditions.push(
      ctx.userId === null ? isNull(auditLogs.userId) : eq(auditLogs.userId, ctx.userId),
    );
  }

  if (input.eventType) conditions.push(buildEventTypeCondition(input.eventType, auditLogs));
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
    const scope = scopedDb(ctx.db, ctx.identity.organizationId);
    const role = yield* tryAsync(() =>
      requireOrgRole(ctx.db, ctx.identity.organizationId, ctx.identity.userId, "member"),
    );
    const conditions = buildAuditConditions(
      input,
      {
        orgId: ctx.identity.organizationId,
        userId: ctx.identity.userId,
        role,
        profileId: extra.profileId,
        surface: extra.surface,
        field: extra.field,
      },
      scope.tables.auditLogs,
    );

    const limit = input.limit ?? 50;
    // §AB-0010 — buildAuditConditions already bakes in the org filter (and the
    // §AB-0043 isNull(userId) branch); findMany would double-add it, so use the
    // escape hatch and preserve the exact WHERE/ordering/limit.
    const result = yield* tryAsync(() =>
      scope.executor
        .select()
        .from(scope.tables.auditLogs)
        .where(and(...conditions))
        .orderBy(desc(scope.tables.auditLogs.id))
        .limit(limit),
    );

    const entries = result.map(serializeAuditEntry);
    const lastEntry = entries[entries.length - 1];
    const nextCursor = entries.length === limit && lastEntry ? String(lastEntry.id) : null;

    return { entries, nextCursor };
  });

const listAuditEntriesForAgent = (
  input: AuditQuery,
  extra: { profileId?: string; surface?: string; field?: string },
) =>
  Effect.gen(function* () {
    const ctx = yield* AgentRequestContextTag;
    const scope = scopedDb(ctx.db, ctx.identity.agentOrganizationId);
    const conditions = buildAuditConditions(
      input,
      {
        orgId: ctx.identity.agentOrganizationId,
        userId: ctx.identity.agentUserId,
        role: "member",
        profileId: extra.profileId,
        surface: extra.surface,
        field: extra.field,
      },
      scope.tables.auditLogs,
    );

    const limit = input.limit ?? 50;
    // §AB-0010 — buildAuditConditions already bakes in the org filter (and the
    // §AB-0043 isNull(userId) branch for orphaned agents); findMany would
    // double-add it, so use the escape hatch and preserve the exact query.
    const result = yield* tryAsync(() =>
      scope.executor
        .select()
        .from(scope.tables.auditLogs)
        .where(and(...conditions))
        .orderBy(desc(scope.tables.auditLogs.id))
        .limit(limit),
    );

    const entries = result.map(serializeAuditEntry);
    const lastEntry = entries[entries.length - 1];
    const nextCursor = entries.length === limit && lastEntry ? String(lastEntry.id) : null;

    return { entries, nextCursor };
  });

export const auditRouter = createTrpcRouter({
  list: scopedSessionProcedure("audit:read")
    .meta({ openapi: { method: "GET", path: "/audit", tags: ["audit"], protect: true } })
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
  listForAgent: agentProcedure
    .input(strictSchema(AuditQueryInputSchema))
    .output(strictSchema(AuditListResultSchema))
    .query(({ ctx, input }) =>
      runAgentEffect(
        ctx,
        listAuditEntriesForAgent(normalizeAuditQuery(input), {
          profileId: input.profileId,
          surface: input.surface,
          field: input.field,
        }),
      ),
    ),
});

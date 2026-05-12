import type { AuditEventType, AuditResult } from "@abadge/core";
import { auditLogs } from "@abadge/db/schema";
import { Effect } from "effect";
import {
  AgentRequestContextTag,
  BaseRequestContextTag,
  SessionRequestContextTag,
  tryAsync,
  UserRequestContextTag,
} from "./effect";

// ---------------------------------------------------------------------------
// auditDenied helpers (W2T12-003)
//
// Write a denied audit row and re-raise the original domain error. The audit
// write is caller-safe: a DB blip does NOT invert the auth-fail (see C1).
// Use auditDeniedSession for sessionProcedure routes (most common),
// auditDeniedUser for userProcedure routes, auditDeniedBase for publicProcedure
// routes with a BaseRequestContext.
// ---------------------------------------------------------------------------

export interface DeniedAuditFields {
  organizationId: string;
  userId: string;
  agentId?: string;
  itemId?: string;
  profileId?: string;
  eventType: AuditEventType;
  reason: string;
  meta?: Record<string, unknown>;
  ipAddress?: string;
}

export const auditDeniedSession = <E extends Error>(
  fields: DeniedAuditFields,
  error: E,
): Effect.Effect<never, E, SessionRequestContextTag> =>
  Effect.gen(function* () {
    yield* logSessionAudit({
      organizationId: fields.organizationId,
      userId: fields.userId,
      agentId: fields.agentId,
      itemId: fields.itemId,
      profileId: fields.profileId,
      eventType: fields.eventType,
      result: "denied",
      ipAddress: fields.ipAddress,
      meta: { reason: fields.reason, ...(fields.meta ?? {}) },
    });
    return yield* Effect.fail(error);
  });

export const auditDeniedUser = <E extends Error>(
  fields: DeniedAuditFields,
  error: E,
): Effect.Effect<never, E, UserRequestContextTag> =>
  Effect.gen(function* () {
    yield* logUserAudit({
      organizationId: fields.organizationId,
      userId: fields.userId,
      agentId: fields.agentId,
      itemId: fields.itemId,
      profileId: fields.profileId,
      eventType: fields.eventType,
      result: "denied",
      ipAddress: fields.ipAddress,
      meta: { reason: fields.reason, ...(fields.meta ?? {}) },
    });
    return yield* Effect.fail(error);
  });

export const auditDeniedBase = <E extends Error>(
  fields: DeniedAuditFields,
  error: E,
): Effect.Effect<never, E, BaseRequestContextTag> =>
  Effect.gen(function* () {
    yield* logBaseAudit({
      organizationId: fields.organizationId,
      userId: fields.userId,
      agentId: fields.agentId,
      itemId: fields.itemId,
      eventType: fields.eventType,
      result: "denied",
      ipAddress: fields.ipAddress,
      meta: { reason: fields.reason, ...(fields.meta ?? {}) },
    });
    return yield* Effect.fail(error);
  });

export interface AuditEntryInput {
  organizationId: string;
  userId: string;
  agentId?: string;
  itemId?: string;
  profileId?: string;
  surface?: string;
  eventType: AuditEventType;
  result: AuditResult;
  deliveryMode?: string;
  field?: string;
  purpose?: string;
  meta?: Record<string, unknown>;
  ipAddress?: string;
}

export function buildAuditRow(entry: AuditEntryInput) {
  return {
    organizationId: entry.organizationId,
    userId: entry.userId,
    agentId: entry.agentId ?? null,
    itemId: entry.itemId ?? null,
    profileId: entry.profileId ?? null,
    surface: entry.surface ?? "api",
    eventType: entry.eventType,
    result: entry.result,
    deliveryMode: entry.deliveryMode ?? null,
    field: entry.field ?? null,
    purpose: entry.purpose ?? null,
    meta: entry.meta ?? {},
    ipAddress: entry.ipAddress ?? null,
  };
}

// Never let an audit-write failure invert the caller's primary mutation.
// On DB error: log a warning for operator visibility and return void.
// A future dead-letter queue can replay from the warning stream.
function withAuditFailureWarning(
  entry: AuditEntryInput,
  effect: Effect.Effect<unknown, Error>,
): Effect.Effect<void, never> {
  return effect.pipe(
    Effect.catchAll((err) => {
      console.warn(
        `audit_write_failed event_type=${entry.eventType} org=${entry.organizationId} user=${entry.userId} err=${err instanceof Error ? err.message : String(err)}`,
      );
      return Effect.void;
    }),
    Effect.asVoid,
  );
}

export const logSessionAudit = (
  entry: AuditEntryInput,
): Effect.Effect<void, never, SessionRequestContextTag> =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    yield* withAuditFailureWarning(
      entry,
      tryAsync(() => ctx.db.insert(auditLogs).values(buildAuditRow(entry))),
    );
  });

export const logUserAudit = (
  entry: AuditEntryInput,
): Effect.Effect<void, never, UserRequestContextTag> =>
  Effect.gen(function* () {
    const ctx = yield* UserRequestContextTag;
    yield* withAuditFailureWarning(
      entry,
      tryAsync(() => ctx.db.insert(auditLogs).values(buildAuditRow(entry))),
    );
  });

export const logAgentAudit = (
  entry: AuditEntryInput,
): Effect.Effect<void, never, AgentRequestContextTag> =>
  Effect.gen(function* () {
    const ctx = yield* AgentRequestContextTag;
    yield* withAuditFailureWarning(
      entry,
      tryAsync(() => ctx.db.insert(auditLogs).values(buildAuditRow(entry))),
    );
  });

export const logBaseAudit = (
  entry: AuditEntryInput,
): Effect.Effect<void, never, BaseRequestContextTag> =>
  Effect.gen(function* () {
    const ctx = yield* BaseRequestContextTag;
    yield* withAuditFailureWarning(
      entry,
      tryAsync(() => ctx.db.insert(auditLogs).values(buildAuditRow(entry))),
    );
  });

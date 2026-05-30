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
import { redactedJson } from "./log";

// ---------------------------------------------------------------------------
// auditDenied helpers
//
// Write a denied audit row and re-raise the original domain error. The audit
// write is caller-safe: a DB blip does NOT invert the auth-fail.
// Use auditDeniedSession for sessionProcedure routes (most common),
// auditDeniedUser for userProcedure routes, auditDeniedBase for publicProcedure
// routes with a BaseRequestContext.
// ---------------------------------------------------------------------------

export interface DeniedAuditFields {
  organizationId: string;
  userId: string | null;
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
  userId: string | null;
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

// Best-effort second audit sink: emit each committed row as a marked structured
// log line that ships off-box to an append-only store, so a DB-side deletion is
// detectable as a row present in the sink but absent from the table. Redacted
// like every structured log (a future caller could put a secret in `meta`), and
// never throws — a sink failure must not invert or block the caller's mutation.
export function mirrorAuditRow(row: ReturnType<typeof buildAuditRow>): void {
  try {
    console.log(redactedJson({ audit_mirror: 1, mirroredAt: new Date().toISOString(), ...row }));
  } catch {
    // Intentionally swallowed — the mirror is best-effort and must never throw.
  }
}

// Never let an audit-write failure invert the caller's primary mutation.
// On DB error: log a warning for operator visibility and return void.
// A future dead-letter queue can replay from the warning stream.
function withAuditFailureWarning(
  entry: AuditEntryInput,
  effect: Effect.Effect<unknown, Error>,
): Effect.Effect<void, never> {
  return effect.pipe(
    // Mirror only after the insert succeeds (tap skips the failure path): a row
    // that never committed must not appear in the sink, or the divergence check
    // would false-positive.
    Effect.tap(() => Effect.sync(() => mirrorAuditRow(buildAuditRow(entry)))),
    Effect.catchAll((err) => {
      // meta is redacted before logging so an audit-write failure can't surface
      // a secret to Workers observability, even if a caller puts sensitive data
      // in `meta`.
      console.warn(
        `audit_write_failed event_type=${entry.eventType} org=${entry.organizationId} user=${entry.userId} meta=${redactedJson(entry.meta ?? {})} err=${err instanceof Error ? err.message : String(err)}`,
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

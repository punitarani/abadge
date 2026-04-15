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

function buildAuditRow(entry: AuditEntryInput) {
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

export const logSessionAudit = (
  entry: AuditEntryInput,
): Effect.Effect<void, Error, SessionRequestContextTag> =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    yield* tryAsync(() => ctx.db.insert(auditLogs).values(buildAuditRow(entry)));
  });

export const logUserAudit = (
  entry: AuditEntryInput,
): Effect.Effect<void, Error, UserRequestContextTag> =>
  Effect.gen(function* () {
    const ctx = yield* UserRequestContextTag;
    yield* tryAsync(() => ctx.db.insert(auditLogs).values(buildAuditRow(entry)));
  });

export const logAgentAudit = (
  entry: AuditEntryInput,
): Effect.Effect<void, Error, AgentRequestContextTag> =>
  Effect.gen(function* () {
    const ctx = yield* AgentRequestContextTag;
    yield* tryAsync(() => ctx.db.insert(auditLogs).values(buildAuditRow(entry)));
  });

export const logBaseAudit = (
  entry: AuditEntryInput,
): Effect.Effect<void, Error, BaseRequestContextTag> =>
  Effect.gen(function* () {
    const ctx = yield* BaseRequestContextTag;
    yield* tryAsync(() => ctx.db.insert(auditLogs).values(buildAuditRow(entry)));
  });

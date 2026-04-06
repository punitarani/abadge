import type { AuditEventType, AuditResult } from "@abadge/core";
import { auditLog } from "@abadge/db/schema";
import { Effect } from "effect";
import {
  AgentRequestContextTag,
  BaseRequestContextTag,
  SessionRequestContextTag,
  tryAsync,
} from "./effect";

export interface AuditEntryInput {
  userId: string;
  agentId?: string;
  itemId?: string;
  eventType: AuditEventType;
  result: AuditResult;
  deliveryMode?: string;
  meta?: Record<string, unknown>;
  ipAddress?: string;
}

export const logSessionAudit = (
  entry: AuditEntryInput,
): Effect.Effect<void, Error, SessionRequestContextTag> =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    yield* tryAsync(() =>
      ctx.db.insert(auditLog).values({
        userId: entry.userId,
        principalId: entry.agentId ?? null,
        itemId: entry.itemId ?? null,
        eventType: entry.eventType,
        result: entry.result,
        deliveryMode: entry.deliveryMode ?? null,
        meta: entry.meta ?? {},
        ipAddress: entry.ipAddress ?? null,
      }),
    );
  });

export const logAgentAudit = (
  entry: AuditEntryInput,
): Effect.Effect<void, Error, AgentRequestContextTag> =>
  Effect.gen(function* () {
    const ctx = yield* AgentRequestContextTag;
    yield* tryAsync(() =>
      ctx.db.insert(auditLog).values({
        userId: entry.userId,
        principalId: entry.agentId ?? null,
        itemId: entry.itemId ?? null,
        eventType: entry.eventType,
        result: entry.result,
        deliveryMode: entry.deliveryMode ?? null,
        meta: entry.meta ?? {},
        ipAddress: entry.ipAddress ?? null,
      }),
    );
  });

export const logBaseAudit = (
  entry: AuditEntryInput,
): Effect.Effect<void, Error, BaseRequestContextTag> =>
  Effect.gen(function* () {
    const ctx = yield* BaseRequestContextTag;
    yield* tryAsync(() =>
      ctx.db.insert(auditLog).values({
        userId: entry.userId,
        principalId: entry.agentId ?? null,
        itemId: entry.itemId ?? null,
        eventType: entry.eventType,
        result: entry.result,
        deliveryMode: entry.deliveryMode ?? null,
        meta: entry.meta ?? {},
        ipAddress: entry.ipAddress ?? null,
      }),
    );
  });

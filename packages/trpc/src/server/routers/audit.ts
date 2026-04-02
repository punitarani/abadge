import { AuditListResultSchema, type AuditQuery, AuditQuerySchema } from "@abadge/core";
import { and, desc, eq, lt } from "@abadge/db";
import { auditLog } from "@abadge/db/schema";
import { Effect } from "effect";
import { runSessionEffect, SessionRequestContextTag, strictSchema } from "../effect";
import { createTrpcRouter, sessionProcedure } from "../init";
import { serializeAuditEntry } from "../serialize";

const listAuditEntries = (input: AuditQuery) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const conditions = [eq(auditLog.userId, ctx.identity.userId)];

    if (input.eventType) conditions.push(eq(auditLog.eventType, input.eventType));
    if (input.result) conditions.push(eq(auditLog.result, input.result));
    if (input.principalId) conditions.push(eq(auditLog.principalId, input.principalId));
    if (input.itemId) conditions.push(eq(auditLog.itemId, input.itemId));
    if (input.cursor) conditions.push(lt(auditLog.id, Number(input.cursor)));

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
  list: sessionProcedure
    .input(strictSchema(AuditQuerySchema))
    .output(strictSchema(AuditListResultSchema))
    .query(({ ctx, input }) => runSessionEffect(ctx, listAuditEntries(input))),
});

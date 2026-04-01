import type { AuditEventType, AuditResult } from "@abadge/core";
import type { Database } from "@abadge/db";
import { auditLog } from "@abadge/db/schema";
import type { Context } from "hono";

/** Extract client IP from request headers (Cloudflare or proxy). */
export function getClientIp(c: Context): string | undefined {
  return (
    c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip")
  );
}

export async function logAudit(
  db: Database,
  entry: {
    userId: string;
    principalId?: string;
    itemId?: string;
    eventType: AuditEventType;
    result: AuditResult;
    deliveryMode?: string;
    meta?: Record<string, unknown>;
    ipAddress?: string;
  },
): Promise<void> {
  await db.insert(auditLog).values({
    userId: entry.userId,
    principalId: entry.principalId ?? null,
    itemId: entry.itemId ?? null,
    eventType: entry.eventType,
    result: entry.result,
    deliveryMode: entry.deliveryMode ?? null,
    meta: entry.meta ?? {},
    ipAddress: entry.ipAddress ?? null,
  });
}

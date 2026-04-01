import type { Database } from "@abadge/db";
import { auditLog } from "@abadge/db/schema";
import type { AuditEventType, AuditResult } from "@abadge/core";

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

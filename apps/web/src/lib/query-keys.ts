import type { AuditQuery } from "@abadge/core";

export const dashboardQueryKeys = {
  items: (): readonly ["items"] => ["items"],
  item: (itemId: string): readonly ["items", string] => ["items", itemId],
  principals: (): readonly ["principals"] => ["principals"],
  grants: (): readonly ["grants"] => ["grants"],
  audit: (input: AuditQuery): readonly ["audit", AuditQuery] => ["audit", input],
};

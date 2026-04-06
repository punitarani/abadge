import type { AuditQuery } from "@abadge/core";

export const dashboardQueryKeys = {
  items: (): readonly ["items"] => ["items"],
  item: (itemId: string): readonly ["items", string] => ["items", itemId],
  itemDisplay: (itemIds: string[]): readonly ["items", "display", string[]] => [
    "items",
    "display",
    itemIds,
  ],
  agents: (): readonly ["agents"] => ["agents"],
  permissions: (): readonly ["permissions"] => ["permissions"],
  audit: (input: AuditQuery): readonly ["audit", AuditQuery] => ["audit", input],
};

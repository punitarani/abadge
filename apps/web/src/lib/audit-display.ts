import type { Agent, ItemSummary } from "@abadge/core";

const AUDIT_FALLBACK_ID_LENGTH = 13;

export interface AuditDisplayValue {
  text: string;
  resolved: boolean;
}

export function buildAuditAgentNameMap(agents: Agent[]): Map<string, string> {
  return new Map(agents.map((agent) => [agent.id, agent.name]));
}

export function buildAuditItemLabelMap(items: ItemSummary[]): Map<string, string> {
  const labels = new Map<string, string>();

  for (const item of items) {
    labels.set(item.id, item.label);
  }

  return labels;
}

export function formatAuditIdFallback(value: string): string {
  return `${value.slice(0, AUDIT_FALLBACK_ID_LENGTH)}…`;
}

export function resolveAuditDisplayValue(
  value: string | null,
  labels: Map<string, string>,
): AuditDisplayValue {
  if (!value) {
    return { text: "\u2014", resolved: false };
  }

  const label = labels.get(value);
  if (label) {
    return { text: label, resolved: true };
  }

  return { text: formatAuditIdFallback(value), resolved: false };
}

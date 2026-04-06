import { AUDIT_EVENT_TYPES, AUDIT_RESULTS } from "@abadge/core";
import { parseAsBoolean, parseAsString, parseAsStringLiteral } from "nuqs";

const auditEventTypeFilters = ["all", ...AUDIT_EVENT_TYPES] as const;
const auditResultFilters = ["all", ...AUDIT_RESULTS] as const;

export type AuditEventTypeFilter = (typeof auditEventTypeFilters)[number];
export type AuditResultFilter = (typeof auditResultFilters)[number];

export const auditFilterParsers = {
  eventType: parseAsStringLiteral(auditEventTypeFilters).withDefault("all"),
  result: parseAsStringLiteral(auditResultFilters).withDefault("all"),
};

export const permissionFilterParsers = {
  agent: parseAsString.withDefault("all"),
  item: parseAsString.withDefault("all"),
  create: parseAsBoolean.withDefault(false),
};

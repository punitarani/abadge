import {
  AGENT_KINDS,
  AUDIT_EVENT_TYPES,
  AUDIT_RESULTS,
  CAPABILITIES,
  STORAGE_MODES,
} from "@abadge/core";
import { parseAsBoolean, parseAsString, parseAsStringLiteral } from "nuqs";

const ALL = "all" as const;

const auditEventTypeFilters = [ALL, ...AUDIT_EVENT_TYPES] as const;
const auditResultFilters = [ALL, ...AUDIT_RESULTS] as const;
const auditDateRangeFilters = [ALL, "7d", "30d"] as const;

export type AuditEventTypeFilter = (typeof auditEventTypeFilters)[number];
export type AuditResultFilter = (typeof auditResultFilters)[number];
export type AuditDateRangeFilter = (typeof auditDateRangeFilters)[number];

export const auditFilterParsers = {
  q: parseAsString.withDefault(""),
  event: parseAsStringLiteral(auditEventTypeFilters).withDefault(ALL),
  result: parseAsStringLiteral(auditResultFilters).withDefault(ALL),
  profile: parseAsString.withDefault(ALL),
  range: parseAsStringLiteral(auditDateRangeFilters).withDefault(ALL),
};

const storageFilters = [ALL, ...STORAGE_MODES] as const;
export type StorageFilter = (typeof storageFilters)[number];

export const itemsFilterParsers = {
  q: parseAsString.withDefault(""),
  storage: parseAsStringLiteral(storageFilters).withDefault(ALL),
  create: parseAsBoolean.withDefault(false),
};

const agentKindFilters = [ALL, ...AGENT_KINDS] as const;
const agentStatusFilters = [ALL, "active", "revoked"] as const;

export type AgentKindFilter = (typeof agentKindFilters)[number];
export type AgentStatusFilter = (typeof agentStatusFilters)[number];

export const agentsFilterParsers = {
  q: parseAsString.withDefault(""),
  kind: parseAsStringLiteral(agentKindFilters).withDefault(ALL),
  status: parseAsStringLiteral(agentStatusFilters).withDefault(ALL),
  create: parseAsBoolean.withDefault(false),
};

const capabilityFilters = [ALL, ...CAPABILITIES] as const;
const expiryFilters = [ALL, "permanent", "expiring", "expired"] as const;

export type CapabilityFilter = (typeof capabilityFilters)[number];
export type ExpiryFilter = (typeof expiryFilters)[number];

export const permissionsFilterParsers = {
  q: parseAsString.withDefault(""),
  agent: parseAsString.withDefault(ALL),
  capability: parseAsStringLiteral(capabilityFilters).withDefault(ALL),
  expiry: parseAsStringLiteral(expiryFilters).withDefault(ALL),
  create: parseAsBoolean.withDefault(false),
};

const vaultStatusFilters = [ALL, "unlocked", "locked"] as const;
export type VaultStatusFilter = (typeof vaultStatusFilters)[number];

export const profilesFilterParsers = {
  q: parseAsString.withDefault(""),
  storage: parseAsStringLiteral(storageFilters).withDefault(ALL),
  vault: parseAsStringLiteral(vaultStatusFilters).withDefault(ALL),
  create: parseAsBoolean.withDefault(false),
};

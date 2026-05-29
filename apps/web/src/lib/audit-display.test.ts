import { describe, expect, test } from "bun:test";
import type { Agent, ItemSummary } from "@abadge/core";
import {
  buildAuditAgentNameMap,
  buildAuditItemLabelMap,
  formatAuditIdFallback,
  resolveAuditDisplayValue,
} from "./audit-display";

describe("audit display helpers", () => {
  test("maps agent ids to agent names", () => {
    const agents: Agent[] = [
      {
        id: "agent_123",
        organizationId: "org_123",
        createdBy: "user_123",
        kind: "local_cli",
        locality: "local",
        authMethod: "public_key_session",
        name: "Deploy bot",
        description: null,
        publicKeyConfigured: true,
        enabled: true,
        revokedAt: null,
        lastUsedAt: null,
        metadata: {},
        createdAt: "2026-04-01T00:00:00.000Z",
      },
    ];

    const agentNames = buildAuditAgentNameMap(agents);

    expect(agentNames.get("agent_123")).toBe("Deploy bot");
  });

  test("uses server-managed labels directly", () => {
    const labels = buildAuditItemLabelMap([
      {
        id: "item_sm_1",
        label: "Production API key",
        storageMode: "server_managed",
        cryptoVersion: 1,
        contentVersion: 1,
        profileId: null,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
      },
    ] satisfies ItemSummary[]);

    expect(labels.get("item_sm_1")).toBe("Production API key");
  });

  test("uses stored labels for zero-knowledge items too", () => {
    const labels = buildAuditItemLabelMap([
      {
        id: "item_zk_1",
        label: "Database password",
        storageMode: "zero_knowledge",
        cryptoVersion: 1,
        contentVersion: 1,
        profileId: null,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
      },
    ] satisfies ItemSummary[]);

    expect(labels.get("item_zk_1")).toBe("Database password");
  });

  test("falls back to ids and em dashes when display values are unavailable", () => {
    expect(resolveAuditDisplayValue(null, new Map())).toEqual({
      text: "\u2014",
      resolved: false,
    });

    const unresolved = resolveAuditDisplayValue("c07e1999-a7eb-42a4", new Map());
    expect(unresolved).toEqual({
      text: formatAuditIdFallback("c07e1999-a7eb-42a4"),
      resolved: false,
    });
  });
});

import { describe, expect, test } from "bun:test";
import type { Agent } from "@abadge/core";
import { encryptItem, serializeItemPayload } from "@abadge/crypto";
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
        userId: "user_123",
        kind: "local_cli",
        locality: "local",
        authMethod: "legacy_api_key",
        name: "Deploy bot",
        publicKeyConfigured: false,
        keyPrefix: "abl_123",
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
    const labels = buildAuditItemLabelMap(
      [
        {
          itemId: "item_sm_1",
          storageMode: "server_managed",
          label: "Production API key",
        },
      ],
      null,
    );

    expect(labels.get("item_sm_1")).toBe("Production API key");
  });

  test("derives zero-knowledge labels only when the vault is unlocked", () => {
    const rootKey = new Uint8Array(32).fill(9);
    const encrypted = encryptItem(
      serializeItemPayload({
        v: 1,
        label: "Database password",
        kind: "opaque",
        tags: [],
        fields: { value: "secret" },
      }),
      rootKey,
    );

    const displayItem = {
      itemId: "item_zk_1",
      storageMode: "zero_knowledge" as const,
      encryptedItemKey: encrypted.encryptedItemKey,
      ciphertext: encrypted.ciphertext,
    };

    expect(buildAuditItemLabelMap([displayItem], null).has("item_zk_1")).toBe(false);
    expect(buildAuditItemLabelMap([displayItem], rootKey).get("item_zk_1")).toBe(
      "Database password",
    );
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

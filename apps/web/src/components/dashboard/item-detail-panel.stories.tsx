import type { ItemDetail, ItemPayload } from "@abadge/core";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { ItemDetailPanelView, type ItemReveal } from "./item-detail-panel";

const zeroKnowledgeItem: ItemDetail = {
  id: "fa3c8cf8-d5ae-4b1f-8dc8-1d58d902ee11",
  label: "Production API Key",
  storageMode: "zero_knowledge",
  cryptoVersion: 1,
  contentVersion: 1,
  profileId: "11111111-1111-1111-1111-111111111111",
  createdAt: "2026-04-04T15:23:00.000Z",
  updatedAt: "2026-04-05T09:42:00.000Z",
  encryptedItemKey: "encrypted-item-key",
  ciphertext: "ciphertext",
};

const serverManagedItem: ItemDetail = {
  id: "c07e1999-a7eb-4f26-af0f-b13f49a32ec8",
  label: "Database Password",
  storageMode: "server_managed",
  cryptoVersion: 1,
  contentVersion: 1,
  profileId: null,
  createdAt: "2026-04-03T11:15:00.000Z",
  updatedAt: "2026-04-03T11:15:00.000Z",
};

const meta: Meta = {
  title: "Dashboard/ItemDetailPanel",
  parameters: {
    layout: "padded",
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Wires a stateful {@link ItemReveal} so the Reveal/Hide buttons work in the
 * story. `isPersonal` drives the workspace posture: personal accounts get the
 * reveal card, team organizations stay in custody mode.
 */
function DemoView({
  item,
  isPersonal,
  payload,
}: {
  item: ItemDetail;
  isPersonal: boolean;
  payload: ItemPayload;
}): React.ReactElement {
  const [revealedPayload, setRevealedPayload] = useState<ItemPayload | null>(null);
  const reveal: ItemReveal = {
    revealedPayload,
    revealing: false,
    reveal: () => setRevealedPayload(payload),
    hide: () => setRevealedPayload(null),
  };
  return (
    <div className="mx-auto w-full max-w-3xl">
      <ItemDetailPanelView item={item} isPersonal={isPersonal} reveal={reveal} />
    </div>
  );
}

export const PersonalZeroKnowledge: Story = {
  render: () => (
    <DemoView
      item={zeroKnowledgeItem}
      isPersonal
      payload={{
        v: 1,
        label: "Production API Key",
        kind: "api_key",
        fields: { value: "sk-live-xxxx" },
      }}
    />
  ),
};

export const PersonalServerManaged: Story = {
  render: () => (
    <DemoView
      item={serverManagedItem}
      isPersonal
      payload={{
        v: 1,
        label: "Database Password",
        kind: "login",
        fields: { username: "app", password: "db-password", url: "postgres://db:5432" },
      }}
    />
  ),
};

// Team organization: custody mode — no reveal affordance, just the ZK note.
export const Custody: Story = {
  render: () => (
    <DemoView
      item={zeroKnowledgeItem}
      isPersonal={false}
      payload={{ v: 1, label: "Production API Key", kind: "api_key", fields: {} }}
    />
  ),
};

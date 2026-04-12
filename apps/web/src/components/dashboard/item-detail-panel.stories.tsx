import type { ItemDetail } from "@abadge/core";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { ItemDetailPanelView } from "./item-detail-panel";

const zeroKnowledgeItem: ItemDetail = {
  id: "fa3c8cf8-d5ae-4b1f-8dc8-1d58d902ee11",
  label: "Production API Key",
  storageMode: "zero_knowledge",
  cryptoVersion: 1,
  contentVersion: 1,
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

function ZeroKnowledgeStory(): React.ReactElement {
  const [revealedValue, setRevealedValue] = useState<string | null>(null);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <ItemDetailPanelView
        item={zeroKnowledgeItem}
        revealedValue={revealedValue}
        revealing={false}
        onReveal={() => setRevealedValue('{\n  "value": "super-secret-value"\n}')}
        onHide={() => setRevealedValue(null)}
      />
    </div>
  );
}

export const ZeroKnowledge: Story = {
  render: () => <ZeroKnowledgeStory />,
};

export const ServerManaged: Story = {
  render: () => (
    <div className="mx-auto w-full max-w-3xl">
      <ItemDetailPanelView
        item={serverManagedItem}
        revealedValue={null}
        revealing={false}
        onReveal={() => undefined}
        onHide={() => undefined}
      />
    </div>
  ),
};

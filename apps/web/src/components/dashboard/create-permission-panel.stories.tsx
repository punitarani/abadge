import { CAPABILITIES, type Capability } from "@abadge/core";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CreatePermissionPanelView } from "./create-permission-panel";

const meta: Meta = {
  title: "Dashboard/CreatePermissionPanel",
  parameters: {
    layout: "padded",
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

const agentOptions = [
  { value: "agent-1", label: "Claude Code (CLI)" },
  { value: "agent-2", label: "CI Pipeline (Remote)" },
];

const itemOptions = [
  { value: "item-1", label: "DB Password (ZK)" },
  { value: "item-2", label: "API Token (server)" },
];

function PermissionStory(): React.ReactElement {
  const [selectedAgent, setSelectedAgent] = useState(agentOptions[0]?.value ?? "");
  const [selectedItem, setSelectedItem] = useState(itemOptions[0]?.value ?? "");
  const [selectedCapabilities, setSelectedCapabilities] = useState<Set<Capability>>(
    () => new Set(),
  );
  const [expiresAt, setExpiresAt] = useState("");

  function toggleCapability(cap: Capability): void {
    setSelectedCapabilities((prev) => {
      const next = new Set(prev);
      if (next.has(cap)) {
        next.delete(cap);
      } else {
        next.add(cap);
      }
      return next;
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 rounded-lg border border-border bg-background p-5">
      <CreatePermissionPanelView
        formId="storybook-create-permission"
        selectedAgent={selectedAgent}
        selectedItem={selectedItem}
        selectedCapabilities={selectedCapabilities}
        alreadyGrantedCapabilities={new Set()}
        optionsLoading={false}
        agentOptions={agentOptions}
        itemOptions={itemOptions}
        allowedCapabilities={CAPABILITIES as readonly Capability[]}
        incompatibleMessage=""
        agentName="Claude Code"
        itemLabel="DB Password"
        expiresAt={expiresAt}
        onAgentChange={setSelectedAgent}
        onItemChange={setSelectedItem}
        onCapabilityToggle={toggleCapability}
        onExpiresAtChange={setExpiresAt}
        onSubmit={(event) => event.preventDefault()}
      />
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="outline" size="sm">
          Cancel
        </Button>
        <Button size="sm" disabled={selectedCapabilities.size === 0}>
          {selectedCapabilities.size > 1
            ? `Grant ${selectedCapabilities.size} capabilities`
            : "Grant permission"}
        </Button>
      </div>
    </div>
  );
}

export const Default: Story = {
  render: () => <PermissionStory />,
};

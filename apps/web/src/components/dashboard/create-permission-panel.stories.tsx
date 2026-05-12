import { CANONICAL_CAPABILITIES, type Capability } from "@abadge/core";
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

const profileOptions = [
  { value: "prof-1", label: "default" },
  { value: "prof-2", label: "acme-corp (externalId: cust_001)" },
];

function PermissionStory(): React.ReactElement {
  const [targetType, setTargetType] = useState<"item" | "profile">("item");
  const [selectedAgent, setSelectedAgent] = useState(agentOptions[0]?.value ?? "");
  const [selectedItem, setSelectedItem] = useState(itemOptions[0]?.value ?? "");
  const [selectedProfile, setSelectedProfile] = useState("");
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
        targetType={targetType}
        selectedAgent={selectedAgent}
        selectedItem={selectedItem}
        selectedProfile={selectedProfile}
        selectedCapabilities={selectedCapabilities}
        alreadyGrantedCapabilities={new Set()}
        optionsLoading={false}
        agentOptions={agentOptions}
        itemOptions={itemOptions}
        profileOptions={profileOptions}
        allowedCapabilities={CANONICAL_CAPABILITIES as readonly Capability[]}
        incompatibleMessage=""
        agentName="Claude Code"
        targetLabel={targetType === "item" ? "DB Password" : "default"}
        expiresAt={expiresAt}
        onTargetTypeChange={setTargetType}
        onAgentChange={setSelectedAgent}
        onItemChange={setSelectedItem}
        onProfileChange={setSelectedProfile}
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

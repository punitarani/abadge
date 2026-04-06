import type { Capability } from "@abadge/core";
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
  { value: "agent-1", label: "Claude Code" },
  { value: "agent-2", label: "CI Pipeline" },
];

const itemOptions = [
  { value: "item-1", label: "ZK · fa3c8cf8-d5ae…" },
  { value: "item-2", label: "Srv · c07e1999-a7eb…" },
];

function PermissionStory({ initialError = "" }: { initialError?: string }): React.ReactElement {
  const [selectedAgent, setSelectedAgent] = useState(agentOptions[0]?.value ?? "");
  const [selectedItem, setSelectedItem] = useState(itemOptions[0]?.value ?? "");
  const [selectedCapability, setSelectedCapability] = useState<Capability>("mount_env");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 rounded-lg border border-border bg-background p-5">
      <CreatePermissionPanelView
        formId="storybook-create-permission"
        selectedAgent={selectedAgent}
        selectedItem={selectedItem}
        selectedCapability={selectedCapability}
        error={initialError}
        optionsLoading={false}
        agentOptions={agentOptions}
        itemOptions={itemOptions}
        onAgentChange={setSelectedAgent}
        onItemChange={setSelectedItem}
        onCapabilityChange={setSelectedCapability}
        onSubmit={(event) => event.preventDefault()}
      />
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="outline" size="sm">
          Cancel
        </Button>
        <Button size="sm">Create permission</Button>
      </div>
    </div>
  );
}

export const Default: Story = {
  render: () => <PermissionStory />,
};

export const ErrorState: Story = {
  render: () => <PermissionStory initialError="Failed to create permission" />,
};

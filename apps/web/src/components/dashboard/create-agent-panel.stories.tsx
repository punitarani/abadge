import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CreateAgentPanel } from "./create-agent-panel";

const meta: Meta = {
  title: "Dashboard/CreateAgentPanel",
  decorators: [
    (Story) => {
      if (typeof navigator !== "undefined") {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText: async () => undefined },
        });
      }
      return (
        <div className="mx-auto w-full max-w-lg rounded-lg border border-border bg-background p-5">
          <Story />
        </div>
      );
    },
  ],
  parameters: {
    layout: "padded",
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

function PanelStory(): React.ReactElement {
  const [open, setOpen] = useState(true);

  return (
    <div>
      <Button size="sm" onClick={() => setOpen(true)}>
        Open panel
      </Button>
      <CreateAgentPanel open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

export const Default: Story = {
  render: () => <PanelStory />,
};

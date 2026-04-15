import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ResponsiveOverlay } from "./responsive-overlay";

const meta: Meta = {
  title: "Dashboard/ResponsiveOverlay",
  parameters: {
    layout: "fullscreen",
  },
  args: {
    title: "Create item",
    description: "Add a secret to your profile.",
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

function OverlayStoryFrame({ forceMobile = false }: { forceMobile?: boolean }): React.ReactElement {
  const [open, setOpen] = useState(true);

  return (
    <div className="min-h-screen bg-muted/30 p-6">
      <div className="mx-auto flex max-w-5xl items-center justify-between rounded-lg border border-border bg-background p-6">
        <div>
          <h1 className="text-lg font-semibold">Items</h1>
          <p className="text-sm text-muted-foreground">Secrets stored in your profile</p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          Open panel
        </Button>
      </div>

      <ResponsiveOverlay
        open={open}
        onOpenChange={setOpen}
        forceMobile={forceMobile}
        title="Create item"
        description="Add a secret to your profile."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm">
              Cancel
            </Button>
            <Button size="sm">Create</Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border p-4">
            <div className="text-sm font-medium">Name</div>
            <div className="text-sm text-muted-foreground">github-deploy-key</div>
          </div>
          <div className="rounded-lg border border-border p-4">
            <div className="text-sm font-medium">Value</div>
            <div className="text-sm text-muted-foreground">Secret content stays in the panel.</div>
          </div>
        </div>
      </ResponsiveOverlay>
    </div>
  );
}

export const DesktopSheet: Story = {
  render: () => <OverlayStoryFrame />,
};

export const MobileDialog: Story = {
  render: () => <OverlayStoryFrame forceMobile />,
};

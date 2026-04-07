import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const meta: Meta = {
  title: "UI/Sonner",
  parameters: {
    layout: "padded",
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Button
      size="sm"
      onClick={() => {
        toast.success("Permission created.", {
          description: "The agent can now access the selected item.",
        });
      }}
    >
      Show success toast
    </Button>
  ),
};

function AutoShowToast(): React.ReactElement {
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      toast.success("Permission created.", {
        description: "The agent can now access the selected item.",
      });
    }, 150);

    return () => window.clearTimeout(timeout);
  }, []);

  return <div className="text-sm text-muted-foreground">Toast should appear automatically.</div>;
}

export const AutoShow: Story = {
  render: () => <AutoShowToast />,
};

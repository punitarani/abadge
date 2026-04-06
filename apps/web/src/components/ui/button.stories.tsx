import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Plus } from "lucide-react";
import { Button } from "./button";

const meta = {
  title: "UI/Button",
  component: Button,
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>Default</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="link">Link button</Button>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
      <Button size="icon" aria-label="Create agent">
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  ),
};

export const Disabled: Story = {
  args: {
    children: "Saving",
    disabled: true,
  },
};

export const WithIcon: Story = {
  render: () => (
    <Button>
      <Plus className="h-4 w-4" />
      Add credential
    </Button>
  ),
};

export const AsChild: Story = {
  render: () => (
    <Button asChild variant="outline">
      <a href="/audit">View audit trail</a>
    </Button>
  ),
};

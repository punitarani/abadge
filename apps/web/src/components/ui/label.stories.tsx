import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Input } from "./input";
import { Label } from "./label";

const meta = {
  title: "UI/Label",
  component: Label,
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof Label>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Standalone: Story = {
  args: {
    children: "Delivery mode",
  },
};

export const WithField: Story = {
  render: () => (
    <div className="w-80 space-y-2">
      <Label htmlFor="delivery-mode">Delivery mode</Label>
      <Input id="delivery-mode" value="env_inject" readOnly />
    </div>
  ),
};

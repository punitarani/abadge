import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Input } from "./input";
import { Label } from "./label";

const meta = {
  title: "UI/Input",
  component: Input,
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof Input>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="w-80 space-y-2">
      <Label htmlFor="credential-name">Credential name</Label>
      <Input id="credential-name" placeholder="OpenAI production key" />
    </div>
  ),
};

export const Disabled: Story = {
  args: {
    value: "Existing secret name",
    disabled: true,
  },
  render: (args) => (
    <div className="w-80 space-y-2">
      <Label htmlFor="disabled-input">Credential name</Label>
      <Input id="disabled-input" {...args} />
    </div>
  ),
};

export const InvalidLooking: Story = {
  render: () => (
    <div className="w-80 space-y-2">
      <Label htmlFor="policy-name">Policy name</Label>
      <Input
        id="policy-name"
        placeholder="Production file mount"
        className="border-red-300 focus-visible:ring-red-500"
      />
    </div>
  ),
};

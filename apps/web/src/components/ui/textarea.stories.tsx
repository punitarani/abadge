import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Label } from "./label";
import { Textarea } from "./textarea";

const meta = {
  title: "UI/Textarea",
  component: Textarea,
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof Textarea>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="w-96 space-y-2">
      <Label htmlFor="policy-description">Policy notes</Label>
      <Textarea
        id="policy-description"
        placeholder="Only permit env injection from approved local CLI sessions."
      />
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div className="w-96 space-y-2">
      <Label htmlFor="disabled-textarea">Connector details</Label>
      <Textarea
        id="disabled-textarea"
        disabled
        value="Connector configuration is managed in the API worker."
      />
    </div>
  ),
};

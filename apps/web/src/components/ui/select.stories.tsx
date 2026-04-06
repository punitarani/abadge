import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Label } from "./label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

const meta = {
  title: "UI/Select",
  component: Select,
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof Select>;

export default meta;

type Story = StoryObj<typeof meta>;

function DeliveryModeSelect(props: {
  defaultOpen?: boolean;
  defaultValue?: string;
  disabled?: boolean;
}): React.ReactElement {
  const { defaultOpen = false, defaultValue, disabled = false } = props;

  return (
    <div className="w-80 space-y-2">
      <Label htmlFor="delivery-mode-select">Delivery mode</Label>
      <Select defaultOpen={defaultOpen} defaultValue={defaultValue}>
        <SelectTrigger id="delivery-mode-select" disabled={disabled}>
          <SelectValue placeholder="Choose a delivery mode" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="env_inject">Env inject</SelectItem>
          <SelectItem value="file_mount">File mount</SelectItem>
          <SelectItem value="reveal">Reveal</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

export const Placeholder: Story = {
  render: () => <DeliveryModeSelect />,
};

export const Selected: Story = {
  render: () => <DeliveryModeSelect defaultValue="env_inject" />,
};

export const Open: Story = {
  render: () => <DeliveryModeSelect defaultOpen defaultValue="file_mount" />,
};

export const Disabled: Story = {
  render: () => <DeliveryModeSelect defaultValue="reveal" disabled />,
};

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AnimatedAbadgeLogo } from "./animated-abadge-logo";

// Annotate `meta` explicitly (rather than `satisfies Meta<…>`): with a
// `decorators` array, the inferred type otherwise reaches into Storybook's
// internal `csf` module, which TS can't name portably across install layouts
// (TS2742). The annotation keeps the emitted type to the named `Meta` import.
const meta: Meta<typeof AnimatedAbadgeLogo> = {
  title: "Brand/AnimatedAbadgeLogo",
  component: AnimatedAbadgeLogo,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <div style={{ width: "min(48rem, 90vw)" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    autoPlay: true,
    loop: false,
    size: "md",
  },
};

export default meta;

type Story = StoryObj<typeof AnimatedAbadgeLogo>;

export const Default: Story = {};

export const Looping: Story = {
  args: { loop: true },
};

export const Small: Story = {
  args: { size: "sm" },
};

export const Large: Story = {
  args: { size: "lg" },
};

export const Static: Story = {
  args: { autoPlay: false },
};

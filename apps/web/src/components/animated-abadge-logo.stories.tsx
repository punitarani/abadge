import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AnimatedAbadgeLogo } from "./animated-abadge-logo";

// Explicit annotation (not `satisfies Meta<…>`) keeps the emitted type on the
// named `Meta` import; the inferred form can reach into Storybook's internal
// `csf` module, which TS can't name portably across install layouts (TS2742).
const meta: Meta<typeof AnimatedAbadgeLogo> = {
  title: "Brand/AnimatedAbadgeLogo",
  component: AnimatedAbadgeLogo,
  parameters: {
    layout: "centered",
  },
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

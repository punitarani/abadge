import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SocialAuthButtons } from "./social-auth-buttons";

const meta = {
  title: "Components/SocialAuthButtons",
  component: SocialAuthButtons,
  parameters: {
    layout: "padded",
  },
  args: {
    onProviderClick: () => undefined,
  },
} satisfies Meta<typeof SocialAuthButtons>;

export default meta;

type Story = StoryObj<typeof meta>;

export const BothProviders: Story = {
  args: {
    providers: ["github", "google"],
    loadingProvider: null,
  },
};

export const SingleProvider: Story = {
  args: {
    providers: ["google"],
    loadingProvider: null,
  },
};

export const Loading: Story = {
  args: {
    providers: ["github", "google"],
    loadingProvider: "github",
  },
};

export const Empty: Story = {
  args: {
    providers: [],
    loadingProvider: null,
  },
};

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SecretDisplay } from "./secret-display";

function ensureClipboard(): void {
  if (typeof navigator === "undefined") {
    return;
  }

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async () => undefined,
    },
  });
}

const meta: Meta<typeof SecretDisplay> = {
  title: "UI/SecretDisplay",
  component: SecretDisplay,
  decorators: [
    (Story) => {
      ensureClipboard();
      return (
        <div className="w-full max-w-2xl">
          <Story />
        </div>
      );
    },
  ],
  parameters: {
    layout: "padded",
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    value: "abg_prod_4eTwM6bqsW7nD9kP2x4k",
  },
};

export const CustomWarning: Story = {
  args: {
    value: "abs_session_GD8f0vQ1wL3r2iV",
    warning: "Session tokens expire automatically. Rotate this token after local testing.",
  },
};

export const WithoutWarning: Story = {
  args: {
    value: "connector://doppler/abadge/prod/openai",
    warning: undefined,
  },
};

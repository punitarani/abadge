import type { Preview } from "@storybook/nextjs-vite";
import { sb } from "storybook/test";
import "../src/app/globals.css";

sb.mock(import("next/image"));

const preview: Preview = {
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    nextjs: {
      appDirectory: true,
    },
  },
};

export default preview;

import type { Preview } from "@storybook/nextjs-vite";
import { Fragment, createElement } from "react";
import { Toaster } from "../src/components/ui/sonner";
import "../src/app/globals.css";

const preview: Preview = {
  decorators: [
    (Story) =>
      createElement(Fragment, null, createElement(Story), createElement(Toaster)),
  ],
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

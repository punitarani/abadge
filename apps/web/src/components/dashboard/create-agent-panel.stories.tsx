import type { AgentKind } from "@abadge/core";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { type AgentRegistrationState, CreateAgentPanelView } from "./create-agent-panel";

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

const meta: Meta = {
  title: "Dashboard/CreateAgentPanel",
  decorators: [
    (Story) => {
      ensureClipboard();
      return (
        <div className="mx-auto w-full max-w-lg rounded-lg border border-border bg-background p-5">
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

function AgentFormStory({ loading = false }: { loading?: boolean }): React.ReactElement {
  const [name, setName] = useState("Claude Code");
  const [kind, setKind] = useState<AgentKind>("remote_agent");
  const [description, setDescription] = useState("Used for local development workflows.");

  return (
    <div className="flex flex-col gap-4">
      <CreateAgentPanelView
        mode="form"
        formId="storybook-create-agent"
        name={name}
        kind={kind}
        description={description}
        onNameChange={setName}
        onKindChange={setKind}
        onDescriptionChange={setDescription}
        onSubmit={(event) => event.preventDefault()}
      />
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="outline" size="sm">
          Cancel
        </Button>
        <Button size="sm" disabled={loading}>
          {loading ? "Registering..." : "Register agent"}
        </Button>
      </div>
    </div>
  );
}

const registration: AgentRegistrationState = {
  apiKey: null,
  bootstrapToken: "abt_bootstrap_c6VMJhRk91eTnX2m",
  bootstrapExpiresAt: "2026-04-06T21:30:00.000Z",
};

export const Default: Story = {
  render: () => <AgentFormStory />,
};

export const Loading: Story = {
  render: () => <AgentFormStory loading />,
};

export const Success: Story = {
  render: () => <CreateAgentPanelView mode="success" registration={registration} />,
};

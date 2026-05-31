import type { ItemKind } from "@abadge/core";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { EditItemPanelView } from "./edit-item-panel";

const meta: Meta = {
  title: "Dashboard/EditItemPanel",
  parameters: {
    layout: "padded",
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

function EditItemStory({
  storageMode,
}: {
  storageMode: "zero_knowledge" | "server_managed";
}): React.ReactElement {
  const [name, setName] = useState("github-deploy-key");
  const [kind, setKind] = useState<ItemKind>("api_key");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({
    api_key: "sk-existing-value",
  });

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 rounded-lg border border-border bg-background p-5">
      <EditItemPanelView
        formId="storybook-edit-item"
        name={name}
        kind={kind}
        storageMode={storageMode}
        fieldValues={fieldValues}
        onNameChange={setName}
        onKindChange={(nextKind) => {
          setKind(nextKind);
          setFieldValues({});
        }}
        onFieldsChange={setFieldValues}
        onSubmit={(event) => event.preventDefault()}
      />
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="outline" size="sm">
          Cancel
        </Button>
        <Button form="storybook-edit-item" type="submit" size="sm">
          {storageMode === "zero_knowledge" ? "Encrypt & save" : "Save"}
        </Button>
      </div>
    </div>
  );
}

export const ServerManaged: Story = {
  render: () => <EditItemStory storageMode="server_managed" />,
};

export const ZeroKnowledge: Story = {
  render: () => <EditItemStory storageMode="zero_knowledge" />,
};

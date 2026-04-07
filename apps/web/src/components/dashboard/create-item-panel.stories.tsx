import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CreateItemPanelView, type StorageMode } from "./create-item-panel";

const meta: Meta = {
  title: "Dashboard/CreateItemPanel",
  parameters: {
    layout: "padded",
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

function CreateItemStory(): React.ReactElement {
  const [name, setName] = useState("github-deploy-key");
  const [value, setValue] = useState("super-secret-value");
  const [storageMode, setStorageMode] = useState<StorageMode>("zero_knowledge");

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 rounded-lg border border-border bg-background p-5">
      <CreateItemPanelView
        formId="storybook-create-item"
        name={name}
        value={value}
        storageMode={storageMode}
        onNameChange={setName}
        onValueChange={setValue}
        onStorageModeChange={setStorageMode}
        onSubmit={(event) => event.preventDefault()}
      />
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="outline" size="sm">
          Cancel
        </Button>
        <Button size="sm">Create</Button>
      </div>
    </div>
  );
}

export const Default: Story = {
  render: () => <CreateItemStory />,
};

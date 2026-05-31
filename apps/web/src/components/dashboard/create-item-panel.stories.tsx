import type { ItemKind, Profile } from "@abadge/core";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CreateItemPanelView } from "./create-item-panel";

const meta: Meta = {
  title: "Dashboard/CreateItemPanel",
  parameters: {
    layout: "padded",
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

function mkProfile(p: Pick<Profile, "id" | "name" | "storageMode"> & Partial<Profile>): Profile {
  return {
    organizationId: "org_1",
    externalId: null,
    description: null,
    wrappedRootKey: null,
    kdfSalt: null,
    kdfParams: null,
    recoveryWrappedRootKey: null,
    keyVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...p,
  } as Profile;
}

function CreateItemStory({ profiles }: { profiles: Profile[] }): React.ReactElement {
  const [name, setName] = useState("github-deploy-key");
  const [kind, setKind] = useState<ItemKind>("opaque");
  const [selectedProfileId, setSelectedProfileId] = useState(profiles[0]?.id ?? "");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

  const selectedProfile = profiles.find((p) => p.id === selectedProfileId) ?? null;
  const storageMode = selectedProfile?.storageMode ?? "server_managed";

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 rounded-lg border border-border bg-background p-5">
      <CreateItemPanelView
        formId="storybook-create-item"
        name={name}
        kind={kind}
        profiles={profiles}
        profilesLoading={false}
        selectedProfileId={selectedProfileId}
        storageMode={storageMode}
        fieldValues={fieldValues}
        onNameChange={setName}
        onKindChange={setKind}
        onSelectProfile={setSelectedProfileId}
        onFieldsChange={setFieldValues}
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

const MULTI_PROFILES = [
  mkProfile({ id: "p_def", name: "default", storageMode: "server_managed", externalId: "default" }),
  mkProfile({ id: "p_zk", name: "personal-secrets", storageMode: "zero_knowledge" }),
];

export const Default: Story = {
  render: () => <CreateItemStory profiles={MULTI_PROFILES} />,
};

export const SingleProfile: Story = {
  render: () => (
    <CreateItemStory
      profiles={[
        mkProfile({
          id: "p_def",
          name: "default",
          storageMode: "server_managed",
          externalId: "default",
        }),
      ]}
    />
  ),
};

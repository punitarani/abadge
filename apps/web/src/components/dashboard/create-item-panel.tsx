"use client";

import type { ItemKind, Profile } from "@abadge/core";
import { ITEM_KINDS } from "@abadge/core";
import { Warning } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useId, useState } from "react";
import { toast } from "sonner";
import { ResponsiveOverlay } from "@/components/dashboard/responsive-overlay";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { encryptItemForProfile } from "@/lib/crypto-client";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { cn } from "@/lib/utils";
import { useVault } from "@/lib/vault-context";
import { useOrgStore } from "@/stores/org-store";

export type StorageMode = "zero_knowledge" | "server_managed";

const KIND_LABELS: Record<ItemKind, string> = {
  api_key: "API Key",
  login: "Login",
  token: "Token",
  certificate: "Certificate",
  ssh_key: "SSH Key",
  json: "JSON",
  opaque: "Opaque",
};

function buildFieldsForKind(
  _kind: ItemKind,
  fieldValues: Record<string, string>,
): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(fieldValues)) {
    if (value.trim()) {
      fields[key] = value;
    }
  }
  return fields;
}

/* ---- Per-kind field editors ---- */

interface FieldEditorProps {
  fields: Record<string, string>;
  onChange: (fields: Record<string, string>) => void;
}

function ApiKeyFields({ fields, onChange }: FieldEditorProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <FieldInput label="Key value" field="value" fields={fields} onChange={onChange} required />
    </div>
  );
}

function LoginFields({ fields, onChange }: FieldEditorProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <FieldInput label="Username" field="username" fields={fields} onChange={onChange} required />
      <FieldInput
        label="Password"
        field="password"
        fields={fields}
        onChange={onChange}
        required
        type="password"
      />
      <FieldInput
        label="URL"
        field="url"
        fields={fields}
        onChange={onChange}
        placeholder="https://..."
      />
      <FieldInput
        label="TOTP secret"
        field="totp_secret"
        fields={fields}
        onChange={onChange}
        placeholder="Optional"
      />
    </div>
  );
}

function TokenFields({ fields, onChange }: FieldEditorProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <FieldInput label="Value" field="value" fields={fields} onChange={onChange} required />
    </div>
  );
}

function CertificateFields({ fields, onChange }: FieldEditorProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <FieldTextarea
        label="Certificate PEM"
        field="cert"
        fields={fields}
        onChange={onChange}
        required
      />
      <FieldTextarea
        label="Private Key PEM"
        field="key"
        fields={fields}
        onChange={onChange}
        required
      />
      <FieldTextarea
        label="Chain"
        field="chain"
        fields={fields}
        onChange={onChange}
        placeholder="Optional intermediate chain"
      />
      <FieldInput
        label="Passphrase"
        field="passphrase"
        fields={fields}
        onChange={onChange}
        type="password"
        placeholder="Optional"
      />
    </div>
  );
}

function SshKeyFields({ fields, onChange }: FieldEditorProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <FieldTextarea
        label="Private Key"
        field="private_key"
        fields={fields}
        onChange={onChange}
        required
      />
      <FieldTextarea
        label="Public Key"
        field="public_key"
        fields={fields}
        onChange={onChange}
        placeholder="Optional"
      />
      <FieldInput
        label="Passphrase"
        field="passphrase"
        fields={fields}
        onChange={onChange}
        type="password"
        placeholder="Optional"
      />
    </div>
  );
}

function JsonFields({ fields, onChange }: FieldEditorProps): React.ReactElement {
  const entries = Object.entries(fields).filter(([key]) => key !== "__json_next_id");
  const addRow = useCallback(() => {
    const nextId = Number(fields.__json_next_id ?? entries.length);
    onChange({ ...fields, [`key_${nextId}`]: "", __json_next_id: String(nextId + 1) });
  }, [fields, entries.length, onChange]);

  const removeRow = useCallback(
    (key: string) => {
      const next = { ...fields };
      delete next[key];
      onChange(next);
    },
    [fields, onChange],
  );

  const updateKey = useCallback(
    (oldKey: string, newKey: string, value: string) => {
      const next = { ...fields };
      delete next[oldKey];
      if (newKey.trim()) {
        next[newKey.trim()] = value;
      }
      onChange(next);
    },
    [fields, onChange],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-medium">Key-value pairs</div>
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-center gap-2">
          <Input
            placeholder="Key"
            value={key.startsWith("key_") ? "" : key}
            onChange={(e) => updateKey(key, e.target.value, value)}
            className="flex-1"
          />
          <Input
            placeholder="Value"
            value={value}
            onChange={(e) => onChange({ ...fields, [key]: e.target.value })}
            className="flex-1"
          />
          <Button type="button" variant="ghost" size="sm" onClick={() => removeRow(key)}>
            &times;
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addRow} className="w-fit">
        + Add field
      </Button>
    </div>
  );
}

function OpaqueFields({ fields, onChange }: FieldEditorProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <FieldTextarea label="Value" field="value" fields={fields} onChange={onChange} required />
    </div>
  );
}

/* ---- Shared field helpers ---- */

function FieldInput({
  label,
  field,
  fields,
  onChange,
  required,
  type = "text",
  placeholder,
}: {
  label: string;
  field: string;
  fields: Record<string, string>;
  onChange: (fields: Record<string, string>) => void;
  required?: boolean;
  type?: string;
  placeholder?: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Input
        type={type}
        value={fields[field] ?? ""}
        onChange={(e) => onChange({ ...fields, [field]: e.target.value })}
        required={required}
        placeholder={placeholder}
      />
    </div>
  );
}

function FieldTextarea({
  label,
  field,
  fields,
  onChange,
  required,
  placeholder,
}: {
  label: string;
  field: string;
  fields: Record<string, string>;
  onChange: (fields: Record<string, string>) => void;
  required?: boolean;
  placeholder?: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Textarea
        value={fields[field] ?? ""}
        onChange={(e) => onChange({ ...fields, [field]: e.target.value })}
        required={required}
        placeholder={placeholder}
        rows={4}
      />
    </div>
  );
}

const KIND_FIELD_EDITORS: Record<ItemKind, React.ComponentType<FieldEditorProps>> = {
  api_key: ApiKeyFields,
  login: LoginFields,
  token: TokenFields,
  certificate: CertificateFields,
  ssh_key: SshKeyFields,
  json: JsonFields,
  opaque: OpaqueFields,
};

/* ---- View ---- */

export interface CreateItemPanelViewProps {
  formId: string;
  name: string;
  kind: ItemKind;
  storageMode: StorageMode;
  fieldValues: Record<string, string>;
  onNameChange: (value: string) => void;
  onKindChange: (kind: ItemKind) => void;
  onStorageModeChange: (value: StorageMode) => void;
  onFieldsChange: (fields: Record<string, string>) => void;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
}

export function CreateItemPanelView({
  formId,
  name,
  kind,
  storageMode,
  fieldValues,
  onNameChange,
  onKindChange,
  onStorageModeChange,
  onFieldsChange,
  onSubmit,
}: CreateItemPanelViewProps): React.ReactElement {
  const FieldEditor = KIND_FIELD_EDITORS[kind];

  return (
    <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="item-name">Name</Label>
        <Input
          id="item-name"
          placeholder="e.g., github-deploy-key"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          required
        />
      </div>

      {/* Kind selector */}
      <fieldset className="flex flex-col gap-2">
        <div className="text-sm font-medium">Kind</div>
        <div className="flex flex-wrap gap-1.5">
          {ITEM_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onKindChange(k)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                k === kind
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-muted",
              )}
            >
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <div className="text-sm font-medium">Storage mode</div>
        <div className="flex flex-col gap-3">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="storageMode"
              value="zero_knowledge"
              checked={storageMode === "zero_knowledge"}
              onChange={() => onStorageModeChange("zero_knowledge")}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Zero-knowledge</span>
              <span className="block text-xs text-muted-foreground">
                Your device, your key. Encrypted in your browser before leaving — only you can
                decrypt. Best for personal secrets. Cannot be accessed by remote agents.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="storageMode"
              value="server_managed"
              checked={storageMode === "server_managed"}
              onChange={() => onStorageModeChange("server_managed")}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Server-managed</span>
              <span className="block text-xs text-muted-foreground">
                Encrypted server-side with AES-256-GCM. Can be accessed by local and remote agents
                through the API. Best for credentials shared with automated systems.
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      {/* ZK warning */}
      {storageMode === "zero_knowledge" && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/30">
          <Warning className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-amber-800 dark:text-amber-300">
            Zero-knowledge items are encrypted in your browser. You will need your profile password to
            decrypt them. The server never sees the plaintext.
          </p>
        </div>
      )}

      {/* Per-kind fields */}
      <FieldEditor fields={fieldValues} onChange={onFieldsChange} />
    </form>
  );
}

/* ---- Container ---- */

interface CreateItemPanelProps {
  open: boolean;
  onClose: () => void;
}

export function CreateItemPanel({ open, onClose }: CreateItemPanelProps): React.ReactElement {
  const queryClient = useQueryClient();
  const { activeOrgId } = useOrgStore();
  const { requestUnlock } = useVault();
  const formId = useId();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ItemKind>("opaque");
  const [storageMode, setStorageMode] = useState<StorageMode>("zero_knowledge");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);

  function handleKindChange(newKind: ItemKind): void {
    setKind(newKind);
    setFieldValues({});
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setCreating(true);

    try {
      const fields = buildFieldsForKind(kind, fieldValues);

      // For JSON kind, clean up the internal tracking key
      const cleanFields = { ...fields };
      delete cleanFields.__json_next_id;

      const payload = {
        v: 1 as const,
        label: name,
        kind,
        tags: [] as string[],
        fields: cleanFields,
      };

      let body:
        | {
            storageMode: "zero_knowledge";
            label: string;
            encryptedItemKey: string;
            ciphertext: string;
          }
        | {
            storageMode: "server_managed";
            payload: typeof payload;
          };

      if (storageMode === "zero_knowledge") {
        if (!activeOrgId) {
          toast.error("Select an organization before creating items.");
          return;
        }

        // The server inserts ZK items into the org's first ZK profile
        // (items router). Resolve the same profile here so the client
        // encrypts with that profile's root key.
        let zkProfileId: string;
        try {
          const result = await browserTrpcClient.profiles.list.query({ orgId: activeOrgId });
          const zkProfile = result.profiles.find(
            (p: Profile) => p.storageMode === "zero_knowledge",
          );
          if (!zkProfile) {
            toast.error("No zero-knowledge profile in this organization. Create one first.");
            return;
          }
          zkProfileId = zkProfile.id;
        } catch (lookupError) {
          toast.error(getClientErrorMessage(lookupError, "Failed to load profiles"));
          return;
        }

        let key: Uint8Array;
        try {
          key = await requestUnlock(zkProfileId);
        } catch {
          toast.error("Master password required.");
          return;
        }

        const encrypted = encryptItemForProfile(payload, key);
        body = {
          storageMode: "zero_knowledge",
          label: name,
          encryptedItemKey: encrypted.encryptedItemKey,
          ciphertext: encrypted.ciphertext,
        };
      } else {
        body = {
          storageMode: "server_managed",
          payload,
        };
      }

      await browserTrpcClient.items.create.mutate(body);
      await queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.orgItems(activeOrgId ?? ""),
      });
      toast.success("Item created.");
      setName("");
      setKind("opaque");
      setFieldValues({});
      onClose();
    } catch (mutationError) {
      toast.error(getClientErrorMessage(mutationError, "Failed to create item"));
    } finally {
      setCreating(false);
    }
  }

  const buttonText = storageMode === "zero_knowledge" ? "Encrypt & save" : "Save";
  const buttonTextCreating = storageMode === "zero_knowledge" ? "Encrypting..." : "Saving...";

  const footer = (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" size="sm" onClick={onClose}>
        Cancel
      </Button>
      <Button form={formId} type="submit" size="sm" disabled={creating}>
        {creating ? buttonTextCreating : buttonText}
      </Button>
    </div>
  );

  const content = (
    <CreateItemPanelView
      formId={formId}
      name={name}
      kind={kind}
      storageMode={storageMode}
      fieldValues={fieldValues}
      onNameChange={setName}
      onKindChange={handleKindChange}
      onStorageModeChange={setStorageMode}
      onFieldsChange={setFieldValues}
      onSubmit={handleSubmit}
    />
  );

  return (
    <ResponsiveOverlay
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
      title="Create item"
      description="Add a secret to your profile."
      footer={footer}
    >
      {content}
    </ResponsiveOverlay>
  );
}

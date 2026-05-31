"use client";

import type { ItemKind, ItemPayload } from "@abadge/core";
import { ITEM_KINDS } from "@abadge/core";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { KIND_FIELD_SPECS, KIND_LABELS } from "@/lib/item-fields";
import { cn } from "@/lib/utils";

/**
 * Shared item-form internals for both the create and edit panels.
 *
 * The create panel adds the storage-mode selector on top of this; the edit
 * panel locks storage mode (the API fixes it on update) and reuses the same
 * name + kind + per-kind field editors. Keeping the editors here means a new
 * item kind is wired once and both panels pick it up.
 */

/** Drop empty values; the JSON `__json_next_id` tracking key is stripped here too. */
export function buildFieldsForKind(
  _kind: ItemKind,
  fieldValues: Record<string, string>,
): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(fieldValues)) {
    if (key === "__json_next_id") continue;
    if (value.trim()) {
      fields[key] = value;
    }
  }
  return fields;
}

/**
 * Flatten a revealed payload's fields into the form's `Record<string, string>`
 * shape so the edit panel can pre-fill. Non-string values (e.g. a `json` item's
 * nested value) are serialized; the editor round-trips them as text.
 */
export function payloadToFieldValues(payload: ItemPayload): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(payload.fields ?? {})) {
    if (raw === undefined || raw === null) continue;
    out[key] = typeof raw === "string" ? raw : JSON.stringify(raw);
  }
  return out;
}

/* ---- Per-kind field editors ---- */

interface FieldEditorProps {
  kind: ItemKind;
  fields: Record<string, string>;
  onChange: (fields: Record<string, string>) => void;
}

/**
 * Generic editor for every standard kind: renders the kind's
 * {@link KIND_FIELD_SPECS} through the shared {@link FieldInput} /
 * {@link FieldTextarea} helpers. The `json` kind has arbitrary keys and uses
 * {@link JsonFields} instead.
 */
function SpecFields({ kind, fields, onChange }: FieldEditorProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      {KIND_FIELD_SPECS[kind].map((spec) =>
        spec.multiline ? (
          <FieldTextarea
            key={spec.field}
            label={spec.label}
            field={spec.field}
            fields={fields}
            onChange={onChange}
            required={spec.required}
            placeholder={spec.placeholder}
          />
        ) : (
          <FieldInput
            key={spec.field}
            label={spec.label}
            field={spec.field}
            fields={fields}
            onChange={onChange}
            required={spec.required}
            type={spec.type}
            placeholder={spec.placeholder}
          />
        ),
      )}
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
  api_key: SpecFields,
  login: SpecFields,
  token: SpecFields,
  certificate: SpecFields,
  ssh_key: SpecFields,
  json: JsonFields,
  opaque: SpecFields,
};

/**
 * Per-kind field editor — `json` gets free-form key/value rows, every other
 * kind renders its {@link KIND_FIELD_SPECS}. Shared by both panels and rendered
 * after the storage-mode region so the form order stays consistent.
 */
export function KindFieldEditor({
  kind,
  fieldValues,
  onChange,
}: {
  kind: ItemKind;
  fieldValues: Record<string, string>;
  onChange: (fields: Record<string, string>) => void;
}): React.ReactElement {
  const FieldEditor = KIND_FIELD_EDITORS[kind];
  return <FieldEditor kind={kind} fields={fieldValues} onChange={onChange} />;
}

/* ---- Shared name + kind selector ---- */

export interface ItemFormFieldsProps {
  name: string;
  kind: ItemKind;
  onNameChange: (value: string) => void;
  onKindChange: (kind: ItemKind) => void;
}

/**
 * Name input + kind selector — the top of the item form, shared verbatim by the
 * create and edit panels. The storage-mode region and the {@link KindFieldEditor}
 * are rendered by each panel afterward (create owns the selector, edit locks it).
 */
export function ItemFormFields({
  name,
  kind,
  onNameChange,
  onKindChange,
}: ItemFormFieldsProps): React.ReactElement {
  return (
    <>
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
    </>
  );
}

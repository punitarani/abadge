import type { ItemKind } from "@abadge/core";

/**
 * Per-kind field presentation, shared by the create-item form
 * (`create-item-panel.tsx`) and the read-only reveal view
 * (`item-detail-panel.tsx`). Keeping labels in one place lets the reveal view
 * render a value the same human-readable way it was entered, instead of dumping
 * the raw stored payload.
 */
export interface ItemFieldSpec {
  /** Key inside `payload.fields`, e.g. "username". */
  field: string;
  /** Human label, e.g. "Username". */
  label: string;
  /** Render as a textarea (form) / multi-line value box (reveal). */
  multiline?: boolean;
  /** Form-only: required input. */
  required?: boolean;
  /** Form-only: input type, e.g. "password". */
  type?: string;
  /** Form-only: placeholder text. */
  placeholder?: string;
}

export const KIND_LABELS: Record<ItemKind, string> = {
  api_key: "API Key",
  login: "Login",
  token: "Token",
  certificate: "Certificate",
  ssh_key: "SSH Key",
  json: "JSON",
  opaque: "Opaque",
};

/**
 * Ordered field specs per kind. `json` is intentionally empty — it holds
 * arbitrary user-defined keys and is edited/rendered specially.
 */
export const KIND_FIELD_SPECS: Record<ItemKind, ItemFieldSpec[]> = {
  api_key: [{ field: "value", label: "Key value", required: true }],
  login: [
    { field: "username", label: "Username", required: true },
    { field: "password", label: "Password", required: true, type: "password" },
    { field: "url", label: "URL", placeholder: "https://..." },
    { field: "totp_secret", label: "TOTP secret", placeholder: "Optional" },
  ],
  token: [{ field: "value", label: "Value", required: true }],
  certificate: [
    { field: "cert", label: "Certificate PEM", required: true, multiline: true },
    { field: "key", label: "Private Key PEM", required: true, multiline: true },
    {
      field: "chain",
      label: "Chain",
      multiline: true,
      placeholder: "Optional intermediate chain",
    },
    { field: "passphrase", label: "Passphrase", type: "password", placeholder: "Optional" },
  ],
  ssh_key: [
    { field: "private_key", label: "Private Key", required: true, multiline: true },
    { field: "public_key", label: "Public Key", multiline: true, placeholder: "Optional" },
    { field: "passphrase", label: "Passphrase", type: "password", placeholder: "Optional" },
  ],
  json: [],
  opaque: [{ field: "value", label: "Value", required: true, multiline: true }],
};

/**
 * Humanize an unknown field key (e.g. a `json` kind's arbitrary key) into a
 * label: "totp_secret" -> "Totp secret".
 */
export function humanizeFieldKey(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").trim();
  if (!spaced) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Display constants for credential metadata in the dashboard UI. */

export const typeLabels: Record<string, string> = {
  api_key: "API Key",
  login: "Login",
  token: "Token",
  json_blob: "JSON",
  oauth_client: "OAuth Client",
  service_account_json: "Service Account",
  cookie_session: "Cookie/Session",
  pii: "PII",
  other: "Other",
};

export const deliveryModeLabels: Record<string, string> = {
  reveal: "Reveal",
  env_inject: "Env Inject",
  file_mount: "File Mount",
  browser_fill: "Browser Fill",
  operation_only: "Operation Only",
};

export const environmentStyles: Record<string, string> = {
  dev: "border-blue-300 text-blue-700 bg-blue-50",
  staging: "border-amber-300 text-amber-700 bg-amber-50",
  prod: "border-red-300 text-red-700 bg-red-50",
};

export const sensitivityVariants: Record<
  string,
  { variant: "default" | "secondary" | "warning" | "destructive" }
> = {
  low: { variant: "secondary" },
  medium: { variant: "default" },
  high: { variant: "warning" },
  critical: { variant: "destructive" },
};

export interface CredentialFormState {
  name: string;
  type: string;
  value: string;
  ownerScope: string;
  environment: string;
  service: string;
  provider: string;
  project: string;
  sensitivity: string;
  allowedDeliveryModes: string[];
  allowedDestinations: string;
  tags: string;
  metadata: string;
}

/** Split a comma-separated string into trimmed, non-empty tokens. */
export function splitCommaList(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parse optional JSON metadata. Returns `{ ok, value?, error? }`. */
export function parseOptionalJson(
  input: string,
): { ok: true; value: Record<string, string> | undefined } | { ok: false; error: string } {
  if (!input.trim()) return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(input) };
  } catch {
    return { ok: false, error: "Invalid JSON in metadata field" };
  }
}

/** For updates, empty optional fields send null to clear. For creates, they are omitted. */
function emptyOptional(isUpdate: boolean): null | undefined {
  return isUpdate ? null : undefined;
}

/** Build the credential request body from form state, omitting empty optional fields. */
export function buildCredentialBody(
  form: CredentialFormState,
  existing?: { name: string; type: string } | null,
): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  const parsed = parseOptionalJson(form.metadata);
  if (!parsed.ok) return parsed;

  const isUpdate = !!existing;
  const absent = emptyOptional(isUpdate);

  const body: Record<string, unknown> = {};
  if (!existing || form.name !== existing.name) body.name = form.name;
  if (!existing || form.type !== existing.type) body.type = form.type;
  if (form.value) body.value = form.value;
  body.ownerScope = form.ownerScope;
  body.environment = form.environment || absent;
  body.service = form.service || absent;
  body.provider = form.provider || absent;
  body.project = form.project || absent;
  body.sensitivity = form.sensitivity;
  body.allowedDeliveryModes = form.allowedDeliveryModes;

  const tags = splitCommaList(form.tags);
  body.tags = tags.length > 0 ? tags : absent;

  const destinations = splitCommaList(form.allowedDestinations);
  body.allowedDestinations = destinations.length > 0 ? destinations : absent;

  if (parsed.value) body.metadata = parsed.value;

  return { ok: true, body };
}

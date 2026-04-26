import { STANDARD_FIELDS_BY_KIND } from "./constants";
import { ENV_VAR_NAME_PATTERN } from "./env-blocklist";
import { FieldNotFoundError, MultiFieldItemError } from "./errors";
import type { ItemPayload } from "./types";

type PartialItemPayload = Pick<Partial<ItemPayload>, "fields" | "kind">;

function getStringFieldNames(fields: ItemPayload["fields"] | undefined): string[] {
  return Object.entries(fields ?? {})
    .filter(([, value]) => typeof value === "string")
    .map(([name]) => name);
}

export function listStringFields(payload: PartialItemPayload | null | undefined): string[] {
  return getStringFieldNames(payload?.fields);
}

function dedupeFields(fields: readonly string[]): string[] {
  return [...new Set(fields)];
}

export function expandFieldSelection(
  payload: PartialItemPayload | null | undefined,
  fields?: readonly string[],
): string[] {
  const availableFields = listStringFields(payload);

  if (fields && fields.length > 0) {
    const requestedFields = dedupeFields(fields);
    for (const field of requestedFields) {
      if (!availableFields.includes(field)) {
        throw new FieldNotFoundError(field, availableFields);
      }
    }
    return requestedFields;
  }

  const kind = payload?.kind;
  if (kind) {
    const preferredFields = STANDARD_FIELDS_BY_KIND[kind].filter((field) =>
      availableFields.includes(field),
    );
    if (preferredFields.length > 0) {
      return preferredFields;
    }
  }

  if (availableFields.includes("value")) {
    return ["value"];
  }

  return availableFields;
}

export function resolveFieldValue(
  payload: PartialItemPayload | null | undefined,
  field?: string,
): string {
  if (field) {
    const value = payload?.fields?.[field];
    const availableFields = listStringFields(payload);
    if (typeof value !== "string") {
      throw new FieldNotFoundError(field, availableFields);
    }
    return value;
  }

  const resolvedFields = expandFieldSelection(payload);
  const [resolvedField] = resolvedFields;
  if (resolvedFields.length === 1 && resolvedField) {
    return payload?.fields?.[resolvedField] as string;
  }

  throw new MultiFieldItemError(resolvedFields);
}

export function resolveFieldValues(
  payload: PartialItemPayload | null | undefined,
  fields?: readonly string[],
): Record<string, string> {
  const resolvedFields = expandFieldSelection(payload, fields);

  return Object.fromEntries(
    resolvedFields.map((field) => [field, payload?.fields?.[field] as string]),
  );
}

/**
 * Normalize an item label into a POSIX-shaped env var name.
 *
 * Used by `abadge run --all` and `abadge export` to turn a user-readable label
 * (e.g. "openai-api-key") into a shell-safe identifier (`OPENAI_API_KEY`).
 *
 * Rules:
 *   1. Uppercase
 *   2. Replace any character outside [A-Z0-9_] with `_`
 *   3. Collapse runs of `_`
 *   4. If the first character is a digit, prepend `_`
 *   5. Strip a single trailing `_` (artifact of step 2 on punctuation-suffixed labels)
 *
 * Returns the empty string when the label normalizes to nothing valid (e.g.
 * "***" → ""). Callers must reject empty results — they are NOT shell-safe.
 *
 * NOTE: This helper does not check `RESERVED_ENV_KEYS`. That check is the
 * caller's responsibility (see `validateEnvVarName`) so the failure mode can
 * carry the offending item's id/label in the error.
 */
export function labelToEnvKey(label: string): string {
  if (typeof label !== "string" || label.length === 0) return "";
  let normalized = label.toUpperCase().replace(/[^A-Z0-9_]+/g, "_");
  normalized = normalized.replace(/_+/g, "_");
  if (normalized.startsWith("_") && normalized.length > 1) {
    // Keep a leading `_` only when it's actually meaningful (the label started
    // with a non-alnum); strip when it's the artifact of a single junk char.
    // Heuristic: trim leading `_` runs that aren't followed by content.
    normalized = normalized.replace(/^_+/, "_");
  }
  if (normalized.endsWith("_") && normalized.length > 1) {
    normalized = normalized.replace(/_+$/, "");
  }
  if (normalized === "_") return "";
  if (normalized.length > 0 && /^[0-9]/.test(normalized)) {
    normalized = `_${normalized}`;
  }
  if (!ENV_VAR_NAME_PATTERN.test(normalized)) return "";
  return normalized;
}

export function payloadToSecret(payload: unknown, field?: string): string {
  if (typeof payload === "string") {
    return payload;
  }

  if (payload && typeof payload === "object") {
    const record = payload as { fields?: Record<string, unknown> };
    if (record.fields && typeof record.fields === "object") {
      return resolveFieldValue(record, field);
    }
  }

  return JSON.stringify(payload);
}

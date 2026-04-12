import { STANDARD_FIELDS_BY_KIND } from "./constants";
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

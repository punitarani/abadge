import { FieldNotFoundError, MultiFieldItemError } from "./errors";
import type { ItemPayload } from "./types";

function getStringFieldNames(fields: ItemPayload["fields"] | undefined): string[] {
  return Object.entries(fields ?? {})
    .filter(([, value]) => typeof value === "string")
    .map(([name]) => name);
}

export function resolveFieldValue(
  payload: Pick<ItemPayload, "fields"> | null | undefined,
  field?: string,
): string {
  const fields = payload?.fields;
  const availableFields = getStringFieldNames(fields);

  if (field) {
    const value = fields?.[field];
    if (typeof value !== "string") {
      throw new FieldNotFoundError(field, availableFields);
    }
    return value;
  }

  const value = fields?.value;
  if (typeof value === "string") {
    return value;
  }

  throw new MultiFieldItemError(availableFields);
}

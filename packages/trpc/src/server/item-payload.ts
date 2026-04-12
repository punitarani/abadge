import type { ItemPayload } from "@abadge/core";

export function decodeServerManagedPayload(
  itemId: string,
  decrypted: Uint8Array,
): ItemPayload & { label: string } {
  const text = new TextDecoder().decode(decrypted);

  try {
    const parsed = JSON.parse(text);
    if (
      parsed &&
      typeof parsed === "object" &&
      "v" in parsed &&
      typeof parsed.v === "number" &&
      "label" in parsed &&
      typeof parsed.label === "string" &&
      "kind" in parsed &&
      parsed.kind === "opaque" &&
      "tags" in parsed &&
      Array.isArray(parsed.tags) &&
      parsed.tags.every((tag: unknown) => typeof tag === "string") &&
      "fields" in parsed &&
      parsed.fields &&
      typeof parsed.fields === "object" &&
      !Array.isArray(parsed.fields)
    ) {
      return parsed as ItemPayload & { label: string };
    }
  } catch {
    // Migrated items were stored as raw strings rather than structured payloads.
  }

  return {
    v: 1,
    label: `migrated-${itemId.slice(0, 8)}`,
    kind: "opaque",
    tags: ["migrated"],
    fields: { value: text },
  };
}

import { ItemPayloadSchema } from "@abadge/core";
import type { ItemPayload } from "@abadge/core";
import { Either, Schema } from "effect";

const migrationFallback = (itemId: string, text: string): ItemPayload & { label: string } => ({
  v: 1,
  label: `migrated-${itemId.slice(0, 8)}`,
  kind: "opaque",
  tags: ["migrated"],
  fields: { value: text },
});

export function decodeServerManagedPayload(
  itemId: string,
  decrypted: Uint8Array,
): ItemPayload & { label: string } {
  const text = new TextDecoder().decode(decrypted);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Migrated items were stored as raw strings rather than structured payloads.
    return migrationFallback(itemId, text);
  }

  const result = Schema.decodeUnknownEither(ItemPayloadSchema)(parsed);
  if (Either.isLeft(result)) {
    return migrationFallback(itemId, text);
  }

  const decoded = result.right;
  return {
    ...decoded,
    label: decoded.label ?? `migrated-${itemId.slice(0, 8)}`,
    kind: decoded.kind ?? "opaque",
  } as ItemPayload & { label: string };
}

// Alias export matching the single public helper contract.
export const decodePayload = decodeServerManagedPayload;

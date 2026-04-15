export function fallbackItemLabel(itemId: string): string {
  return `migrated-${itemId.slice(0, 8)}`;
}

export function resolveStoredLabel(itemId: string, label?: string | null): string {
  const trimmed = label?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallbackItemLabel(itemId);
}

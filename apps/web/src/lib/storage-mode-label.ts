type StorageMode = "zero_knowledge" | "server_managed";

export function storageModeLabel(storageMode: StorageMode): string {
  return storageMode === "zero_knowledge" ? "Zero-knowledge" : "Server-managed";
}

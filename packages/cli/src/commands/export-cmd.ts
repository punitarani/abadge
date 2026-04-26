import { labelToEnvKey } from "@abadge/core";
import { Command } from "commander";
import { createUserApiClient } from "../client";
import { error, errorMessage, warn } from "../output";

// Single shared normalization with `abadge run --all`. Falls back to the raw
// uppercased label when `labelToEnvKey` rejects (returns "") so the export
// stays a best-effort dump and never silently drops a row.
function toEnvKey(label: string): string {
  const normalized = labelToEnvKey(label);
  if (normalized.length > 0) return normalized;
  return label.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}

function quoteEnvValue(value: string): string {
  if (value.includes("\n") || value.includes('"') || value.includes("'")) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
  }
  return value;
}

function extractPayloadValue(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (payload && typeof payload === "object") {
    const rec = payload as { fields?: { value?: unknown } };
    if (rec.fields?.value != null) return String(rec.fields.value);
  }
  return JSON.stringify(payload ?? "");
}

function printEntries(entries: Array<{ key: string; value: string }>, format: string): void {
  if (format === "json") {
    const obj: Record<string, string> = {};
    for (const { key, value } of entries) obj[key] = value;
    console.log(JSON.stringify(obj, null, 2));
  } else {
    for (const { key, value } of entries) {
      console.log(`${toEnvKey(key)}=${quoteEnvValue(value)}`);
    }
  }
}

async function runExport(format: string): Promise<void> {
  const userClient = await createUserApiClient();
  const items = (await userClient.listItems()).items;

  const exported: Array<{ key: string; value: string }> = [];

  for (const item of items) {
    if (item.storageMode === "zero_knowledge") {
      warn(`Skipping zero-knowledge item '${item.label}' — unlock vault to export ZK items.`);
      continue;
    }
    try {
      const revealed = await userClient.ownerReveal(item.id);
      exported.push({ key: item.label, value: extractPayloadValue(revealed.payload) });
    } catch (err) {
      warn(`Failed to reveal '${item.label}': ${errorMessage(err, "unknown error")} — skipping.`);
    }
  }

  printEntries(exported, format);
}

export function createExportCommand(): Command {
  return new Command("export")
    .description("Export secrets from the active profile to stdout")
    .option("--format <format>", "Output format: env or json", "env")
    .action(async (opts: { format?: string }) => {
      const format = opts.format ?? "env";
      if (format !== "env" && format !== "json") {
        error("Format must be one of: env, json");
        process.exit(1);
      }
      try {
        await runExport(format);
      } catch (err) {
        error(errorMessage(err, "Failed to export secrets."));
        process.exit(1);
      }
    });
}

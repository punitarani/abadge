import { readFileSync } from "node:fs";
import { ITEM_KINDS, type ItemKind } from "@abadge/core";
import { Command } from "commander";
import { createSessionApiClient } from "../client";
import { error, errorMessage, success, warn } from "../output";

interface EnvEntry {
  key: string;
  value: string;
}

function parseEnvFile(content: string): EnvEntry[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const idx = line.indexOf("=");
      const key = line.slice(0, idx).trim();
      const raw = line.slice(idx + 1).trim();
      const value = /^(['"]).*\1$/.test(raw) ? raw.slice(1, -1) : raw;
      return { key, value };
    })
    .filter((entry) => entry.key.length > 0);
}

function validateKind(kind: string): kind is ItemKind {
  return ITEM_KINDS.includes(kind as ItemKind);
}

async function importEntry(
  client: Awaited<ReturnType<typeof createSessionApiClient>>,
  entry: EnvEntry,
  kind: ItemKind,
  opts: { dryRun?: boolean; overwrite?: boolean },
  existingLabels: Set<string>,
): Promise<"created" | "skipped"> {
  const exists = existingLabels.has(entry.key);
  if (exists && !opts.overwrite) {
    warn(`Item '${entry.key}' already exists, skipping (use --overwrite to replace).`);
    return "skipped";
  }
  if (opts.dryRun) {
    console.log(`  [dry-run] Would ${exists ? "overwrite" : "create"} item '${entry.key}'`);
    return "created";
  }
  try {
    await client.createItem({
      storageMode: "server_managed",
      payload: { v: 1, label: entry.key, kind, tags: [], fields: { value: entry.value } },
    });
    success(`Imported '${entry.key}'`);
    return "created";
  } catch (err) {
    error(`Failed to import '${entry.key}': ${errorMessage(err, "unknown error")}`);
    return "skipped";
  }
}

async function runImport(
  file: string,
  opts: { dryRun?: boolean; kind?: string; overwrite?: boolean },
): Promise<void> {
  let content: string;
  try {
    content = readFileSync(file, "utf-8");
  } catch (err) {
    error(errorMessage(err, `Failed to read file: ${file}`));
    process.exit(1);
  }

  const entries = parseEnvFile(content);
  if (entries.length === 0) {
    warn("No entries found in file.");
    return;
  }

  const kind = (opts.kind ?? "opaque") as ItemKind;
  if (!validateKind(kind)) {
    error(`Kind must be one of: ${ITEM_KINDS.join(", ")}`);
    process.exit(1);
  }

  const client = await createSessionApiClient();
  const existing = (await client.listItems()).items;
  const existingLabels = new Set(existing.map((i) => i.label));

  let created = 0;
  let skipped = 0;

  for (const entry of entries) {
    const result = await importEntry(client, entry, kind, opts, existingLabels);
    if (result === "created") created++;
    else skipped++;
  }

  const suffix = opts.dryRun ? " (dry-run)" : "";
  console.log(`\nImport complete${suffix}: ${created} created, ${skipped} skipped.`);
}

export function createImportCommand(): Command {
  return new Command("import")
    .description("Import secrets from a .env file")
    .argument("<file>", "Path to .env file")
    .option("--dry-run", "Preview what would happen without writing")
    .option("--kind <kind>", "Item kind", "opaque")
    .option("--overwrite", "Overwrite existing items with the same label")
    .action(
      async (file: string, opts: { dryRun?: boolean; kind?: string; overwrite?: boolean }) => {
        try {
          await runImport(file, opts);
        } catch (err) {
          error(errorMessage(err, "Import failed."));
          process.exit(1);
        }
      },
    );
}

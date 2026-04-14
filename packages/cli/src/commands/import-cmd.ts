import { readFileSync } from "node:fs";
import { ITEM_KINDS, type ItemKind, type ItemSummary } from "@abadge/core";
import type { AbadgeUserClient } from "@abadge/sdk";
import { Command } from "commander";
import { createUserApiClient } from "../client";
import { error, errorMessage, success, warn } from "../output";

interface EnvEntry {
  key: string;
  value: string;
}

export interface ImportOptions {
  dryRun?: boolean;
  overwrite?: boolean;
}

export interface ImportSummary {
  created: number;
  updated: number;
  skipped: number;
}

type ImportClient = Pick<AbadgeUserClient, "listItems" | "createItem" | "updateItem">;

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

type ImportOutcome = "created" | "updated" | "skipped";

async function importEntry(
  client: ImportClient,
  entry: EnvEntry,
  kind: ItemKind,
  opts: ImportOptions,
  existing: ItemSummary | undefined,
): Promise<ImportOutcome> {
  const payload = { v: 1, label: entry.key, kind, tags: [], fields: { value: entry.value } };

  if (existing) {
    if (!opts.overwrite) {
      warn(`Item '${entry.key}' already exists, skipping (use --overwrite to replace).`);
      return "skipped";
    }
    // Import only writes server_managed items. Overwriting a zero_knowledge item
    // would need the profile unlocked via the daemon to rewrap the new DEK; not
    // supported for now — users should `abadge item delete` + re-import, or use
    // `abadge item update` interactively.
    if (existing.storageMode !== "server_managed") {
      error(
        `Cannot overwrite '${entry.key}': existing item uses ${existing.storageMode} storage. Delete it first or use 'abadge item update'.`,
      );
      return "skipped";
    }
    if (opts.dryRun) {
      console.log(`  [dry-run] Would overwrite item '${entry.key}'`);
      return "updated";
    }
    try {
      await client.updateItem(existing.id, {
        storageMode: "server_managed",
        payload,
        contentVersion: existing.contentVersion,
      });
      success(`Updated '${entry.key}'`);
      return "updated";
    } catch (err) {
      error(`Failed to update '${entry.key}': ${errorMessage(err, "unknown error")}`);
      return "skipped";
    }
  }

  if (opts.dryRun) {
    console.log(`  [dry-run] Would create item '${entry.key}'`);
    return "created";
  }
  try {
    await client.createItem({ storageMode: "server_managed", payload });
    success(`Imported '${entry.key}'`);
    return "created";
  } catch (err) {
    error(`Failed to import '${entry.key}': ${errorMessage(err, "unknown error")}`);
    return "skipped";
  }
}

export async function importEntries(
  client: ImportClient,
  entries: EnvEntry[],
  kind: ItemKind,
  opts: ImportOptions,
): Promise<ImportSummary> {
  const existing = (await client.listItems()).items;
  const existingByLabel = new Map(existing.map((i) => [i.label, i]));

  const summary: ImportSummary = { created: 0, updated: 0, skipped: 0 };
  for (const entry of entries) {
    const outcome = await importEntry(client, entry, kind, opts, existingByLabel.get(entry.key));
    summary[outcome]++;
  }
  return summary;
}

async function runImport(
  file: string,
  opts: { dryRun?: boolean; kind?: string; overwrite?: boolean },
): Promise<void> {
  let content: string;
  try {
    content = readFileSync(file, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      error(`File not found: ${file}`);
    } else if (code === "EACCES") {
      error(`Permission denied: ${file}`);
    } else {
      error(errorMessage(err, `Failed to read file: ${file}`));
    }
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

  const client = await createUserApiClient();
  const { created, updated, skipped } = await importEntries(client, entries, kind, {
    dryRun: opts.dryRun,
    overwrite: opts.overwrite,
  });

  const suffix = opts.dryRun ? " (dry-run)" : "";
  console.log(
    `\nImport complete${suffix}: ${created} created, ${updated} updated, ${skipped} skipped.`,
  );
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

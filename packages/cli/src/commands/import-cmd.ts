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
  /** Net-new items written to the API. */
  created: number;
  /** Existing items overwritten via `--overwrite`. */
  updated: number;
  /** Existing items left alone because `--overwrite` was not set. */
  skipped: number;
  /** Existing zero_knowledge items refused (cannot be rewrapped from this path). */
  refused: number;
  /** API errors during create/update. CLI exits non-zero when this is > 0. */
  failed: number;
}

type ImportClient = Pick<AbadgeUserClient, "items">;

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

type ImportOutcome = "created" | "updated" | "skipped" | "refused" | "failed";

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
      return "refused";
    }
    if (opts.dryRun) {
      console.log(`  [dry-run] Would overwrite item '${entry.key}'`);
      return "updated";
    }
    try {
      await client.items.update(existing.id, {
        storageMode: "server_managed",
        payload,
        contentVersion: existing.contentVersion,
      });
      success(`Updated '${entry.key}'`);
      return "updated";
    } catch (err) {
      error(`Failed to update '${entry.key}': ${errorMessage(err, "unknown error")}`);
      return "failed";
    }
  }

  if (opts.dryRun) {
    console.log(`  [dry-run] Would create item '${entry.key}'`);
    return "created";
  }
  try {
    await client.items.create({ storageMode: "server_managed", payload });
    success(`Imported '${entry.key}'`);
    return "created";
  } catch (err) {
    error(`Failed to import '${entry.key}': ${errorMessage(err, "unknown error")}`);
    return "failed";
  }
}

export async function importEntries(
  client: ImportClient,
  entries: EnvEntry[],
  kind: ItemKind,
  opts: ImportOptions,
): Promise<ImportSummary> {
  const existing = (await client.items.list()).items;
  const existingByLabel = new Map(existing.map((i) => [i.label, i]));

  const summary: ImportSummary = {
    created: 0,
    updated: 0,
    skipped: 0,
    refused: 0,
    failed: 0,
  };
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
  const summary = await importEntries(client, entries, kind, {
    dryRun: opts.dryRun,
    overwrite: opts.overwrite,
  });

  const suffix = opts.dryRun ? " (dry-run)" : "";
  // Always show the three "happy" buckets so a clean run is unambiguous; only
  // mention `refused` and `failed` when nonzero so success output stays terse.
  const parts = [
    `${summary.created} created`,
    `${summary.updated} updated`,
    `${summary.skipped} skipped`,
  ];
  if (summary.refused > 0) parts.push(`${summary.refused} refused`);
  if (summary.failed > 0) parts.push(`${summary.failed} failed`);
  console.log(`\nImport complete${suffix}: ${parts.join(", ")}.`);

  // Non-zero exit on real failures so CI pipelines surface the problem. Refused
  // and skipped are intentional outcomes (user policy / missing --overwrite),
  // not errors — they do not flip the exit code.
  if (summary.failed > 0) {
    process.exit(1);
  }
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

import { ITEM_KINDS, type ItemKind } from "@abadge/core";
import type { AbadgeUserClient, CreateItemInput } from "@abadge/sdk";
import { Command } from "commander";
import { createUserApiClient } from "../client";
import { loadConfig } from "../config";
import { daemonDecrypt, daemonEncrypt } from "../daemon";
import { error, errorMessage, json, success, table } from "../output";
import { prompt } from "../prompt";

/**
 * §W1S7-001 — Resolve the ZK profile id the server will insert into. The
 * server picks the first ZK profile in the active org (see
 * `insertZeroKnowledgeItem` in the items router); we match that here so the
 * AAD we bind at encrypt time matches the row the server persists.
 */
async function resolveZkProfileId(client: AbadgeUserClient): Promise<string> {
  const config = loadConfig();
  if (!config?.activeOrgId) {
    throw new Error("No active organization configured. Run `abadge org use <orgId>` first.");
  }
  const result = await client.listProfiles(config.activeOrgId);
  const zkProfile = result.profiles.find((p) => p.storageMode === "zero_knowledge");
  if (!zkProfile) {
    throw new Error(
      "No zero-knowledge profile in this organization. Create one with `abadge profile create --storage-mode zero_knowledge`.",
    );
  }
  return zkProfile.id;
}

type ItemPayload = Extract<CreateItemInput, { storageMode: "server_managed" }>["payload"];
type CreateItemOptions = {
  name?: string;
  label?: string;
  kind?: string;
  value?: string;
  storageMode?: string;
  json?: boolean;
};
type CreateItemValues = {
  label: string;
  kind: ItemKind;
  value: string;
  storageMode: "zero_knowledge" | "server_managed";
};

function buildPayload(label: string, value: string, kind: ItemKind): ItemPayload {
  return {
    v: 1,
    label,
    kind,
    tags: [],
    fields: { value },
  };
}

async function readCreateItemValues(opts: CreateItemOptions): Promise<CreateItemValues> {
  if (opts.value && process.stdin.isTTY) {
    error(
      "The --value flag is not accepted on a TTY to prevent shell history leaks. Pipe the value instead: echo 'mysecret' | abadge item create --label 'name'",
    );
    process.exit(1);
  }

  const label = opts.label ?? opts.name ?? (await prompt("Label: "));
  const value = opts.value ?? (await prompt("Value (secret): ", true));

  if (!label || !value) {
    error("Label and value are required.");
    process.exit(1);
  }

  const kind = (opts.kind ?? "opaque") as ItemKind;
  if (!ITEM_KINDS.includes(kind)) {
    error(`Kind must be one of: ${ITEM_KINDS.join(", ")}`);
    process.exit(1);
  }

  const storageMode = opts.storageMode ?? "server_managed";
  if (storageMode !== "zero_knowledge" && storageMode !== "server_managed") {
    error("Storage mode must be one of: zero_knowledge, server_managed");
    process.exit(1);
  }

  return { label, kind, value, storageMode };
}

async function buildCreateItemInput(
  values: CreateItemValues,
  resolveZkProfileId: () => Promise<string>,
): Promise<CreateItemInput> {
  const payload = buildPayload(values.label, values.value, values.kind);
  if (values.storageMode === "server_managed") {
    return {
      storageMode: "server_managed",
      payload,
    };
  }

  // §W1S7-001 — ZK path: itemId is bound into the XChaCha20-Poly1305 AAD at
  // encrypt time, so we mint the UUID here and pass the same value to both
  // the daemon (for the AAD) and the server insert (for the row id).
  const profileId = await resolveZkProfileId();
  const itemId = crypto.randomUUID();
  const encrypted = await daemonEncrypt(payload, { profileId, itemId });
  return {
    storageMode: "zero_knowledge",
    id: itemId,
    label: values.label,
    encryptedItemKey: encrypted.encryptedItemKey,
    ciphertext: encrypted.ciphertext,
  };
}

export function createItemCommand(): Command {
  const cmd = new Command("item").description("Manage vault items");

  cmd
    .command("create")
    .description("Create a new vault item")
    .option("--name <name>", "Item label")
    .option("--label <label>", "Item label")
    .option("--kind <kind>", "Item kind")
    .option("--value <value>", "Secret value")
    .option("--storage-mode <mode>", "zero_knowledge or server_managed")
    .option("--json", "Output as JSON")
    .action(async (opts: CreateItemOptions) => {
      try {
        const client = await createUserApiClient();
        const values = await readCreateItemValues(opts);
        const result = await client.createItem(
          await buildCreateItemInput(values, () => resolveZkProfileId(client)),
        );
        if (opts.json) {
          json(result);
          return;
        }

        success(`Item created (id: ${result.id}).`);
      } catch (err) {
        error(errorMessage(err, "Failed to create item."));
        process.exit(1);
      }
    });

  cmd
    .command("list")
    .description("List all vault items")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      try {
        const client = await createUserApiClient();
        const items = (await client.listItems()).items;

        if (opts.json) {
          json(items);
          return;
        }

        table(
          items.map((item) => ({
            ID: item.id,
            Label: item.label,
            Storage: item.storageMode,
            Created: item.createdAt,
          })),
        );
      } catch (err) {
        error(errorMessage(err, "Failed to list items."));
        process.exit(1);
      }
    });

  cmd
    .command("get")
    .description("Get a vault item")
    .argument("<id>", "Item ID")
    .option("--json", "Output as JSON")
    .option("--reveal", "Decrypt zero-knowledge item locally")
    .action(async (id: string, opts: { json?: boolean; reveal?: boolean }) => {
      try {
        const client = await createUserApiClient();
        const item = (await client.getItem(id)).item;

        if (!opts.reveal || item.storageMode !== "zero_knowledge") {
          if (opts.json) {
            json(item);
          } else {
            table([
              {
                ID: item.id,
                Label: item.label,
                Storage: item.storageMode,
                Version: String(item.contentVersion),
                Created: item.createdAt,
                Updated: item.updatedAt,
              },
            ]);
          }
          return;
        }

        // §W1S7-001 — reveal needs profileId + contentVersion to rebuild AAD.
        if (!item.profileId) {
          throw new Error("Item is missing a profile binding; cannot decrypt.");
        }
        const decrypted = await daemonDecrypt(item.encryptedItemKey, item.ciphertext, {
          profileId: item.profileId,
          itemId: item.id,
          contentVersion: item.contentVersion,
        });
        json({
          ...item,
          payload: decrypted.payload,
        });
      } catch (err) {
        error(errorMessage(err, "Failed to get item."));
        process.exit(1);
      }
    });

  cmd
    .command("update")
    .description("Update a vault item")
    .argument("<id>", "Item ID")
    .option("--json", "Output as JSON")
    .action(async (id: string, opts: { json?: boolean }) => {
      try {
        const client = await createUserApiClient();
        const currentItem = (await client.getItem(id)).item;
        const label = await prompt("Label: ");
        const kind = await prompt(`Kind (${ITEM_KINDS.join(", ")}): `);
        const value = await prompt("Value (secret): ", true);

        if (!label || !kind || !value) {
          error("Label, kind, and value are required.");
          process.exit(1);
        }

        if (!ITEM_KINDS.includes(kind as ItemKind)) {
          error(`Kind must be one of: ${ITEM_KINDS.join(", ")}`);
          process.exit(1);
        }

        const payload = buildPayload(label, value, kind as ItemKind);
        let result: { ok: boolean; contentVersion: number };

        if (currentItem.storageMode === "zero_knowledge") {
          // §W1S7-001 — the update will land as contentVersion = current + 1;
          // bind that NEW version into the AAD so the refreshed row decrypts
          // with the same contentVersion the server persists.
          if (!currentItem.profileId) {
            throw new Error("Item is missing a profile binding; cannot update.");
          }
          const nextContentVersion = currentItem.contentVersion + 1;
          const encrypted = await daemonEncrypt(payload, {
            profileId: currentItem.profileId,
            itemId: currentItem.id,
            contentVersion: nextContentVersion,
          });
          result = await client.updateItem(id, {
            storageMode: "zero_knowledge",
            label,
            encryptedItemKey: encrypted.encryptedItemKey,
            ciphertext: encrypted.ciphertext,
            contentVersion: currentItem.contentVersion,
          });
        } else {
          result = await client.updateItem(id, {
            storageMode: "server_managed",
            payload,
            contentVersion: currentItem.contentVersion,
          });
        }

        if (opts.json) {
          json(result);
          return;
        }

        success(`Item ${id} updated (version ${result.contentVersion}).`);
      } catch (err) {
        error(errorMessage(err, "Failed to update item."));
        process.exit(1);
      }
    });

  cmd
    .command("delete")
    .description("Delete a vault item")
    .argument("<id>", "Item ID")
    .option("-f, --force", "Skip confirmation")
    .action(async (id: string, opts: { force?: boolean }) => {
      if (!opts.force) {
        const confirm = await prompt(`Delete item ${id}? (y/N): `);
        if (confirm?.toLowerCase() !== "y") {
          console.log("Cancelled.");
          return;
        }
      }

      try {
        const client = await createUserApiClient();
        await client.deleteItem(id);
        success(`Item ${id} deleted.`);
      } catch (err) {
        error(errorMessage(err, "Failed to delete item."));
        process.exit(1);
      }
    });

  return cmd;
}

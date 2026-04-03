import { Command } from "commander";
import { ITEM_KINDS, type ItemKind } from "@abadge/core";
import { ApiClient } from "../client";
import { requireConfig } from "../config";
import { daemonDecrypt, daemonEncrypt } from "../daemon";
import { error, errorMessage, json, success, table } from "../output";
import { prompt } from "../prompt";

export async function itemCommand(args: string[]): Promise<void> {
  const cmd = new Command("item").description("Manage vault items");

  cmd
    .command("create")
    .description("Create a new vault item")
    .action(async () => {
      const config = requireConfig();
      const client = new ApiClient(config);

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

      let encryptedItem:
        | {
            encryptedItemKey: string;
            ciphertext: string;
          }
        | undefined;
      try {
        const encRes = await daemonEncrypt({
          v: 1,
          label,
          kind,
          tags: [],
          fields: { value },
        });
        if (!encRes.ok || !encRes.data) {
          error(encRes.error ?? "Encryption failed.");
          process.exit(1);
        }
        encryptedItem = encRes.data as {
          encryptedItemKey: string;
          ciphertext: string;
        };
      } catch (err) {
        error(errorMessage(err, "Failed to encrypt via daemon."));
        process.exit(1);
      }

      try {
        const result = await client.createItem({
          storageMode: "zero_knowledge",
          encryptedItemKey: encryptedItem.encryptedItemKey,
          ciphertext: encryptedItem.ciphertext,
        });
        success("Item created.");
        json(result);
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
      const config = requireConfig();
      const client = new ApiClient(config);

      try {
        const items = (await client.listItems()).items;

        if (opts.json) {
          json(items);
          return;
        }

        table(
          items.map((i) => ({
            ID: i.id,
            Storage: i.storageMode,
            Crypto: String(i.cryptoVersion),
            Version: String(i.contentVersion),
            Created: i.createdAt,
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
    .action(async (id: string) => {
      const config = requireConfig();
      const client = new ApiClient(config);

      try {
        const item = (await client.getItem(id)).item;

        if (item.storageMode === "zero_knowledge") {
          try {
            const decRes = await daemonDecrypt(item.encryptedItemKey, item.ciphertext);
            if (decRes.ok && decRes.data) {
              json({
                ...item,
                payload: (decRes.data as { payload: unknown }).payload,
              });
              return;
            }
            error("Vault is locked or decryption failed. Run `abadge vault unlock` first.");
            json(item);
          } catch {
            error("Cannot decrypt — daemon unavailable. Showing encrypted item.");
            json(item);
          }
        } else {
          json(item);
        }
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
      const config = requireConfig();
      const client = new ApiClient(config);

      let currentItem: Awaited<ReturnType<typeof client.getItem>>["item"];
      try {
        currentItem = (await client.getItem(id)).item;
      } catch (err) {
        error(errorMessage(err, "Failed to fetch item."));
        process.exit(1);
      }

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

      try {
        let result: { ok: boolean; contentVersion: number };

        if (currentItem.storageMode === "zero_knowledge") {
          const encRes = await daemonEncrypt({
            v: 1,
            label,
            kind,
            tags: [],
            fields: { value },
          });
          if (!encRes.ok || !encRes.data) {
            error(encRes.error ?? "Encryption failed.");
            process.exit(1);
          }
          const encrypted = encRes.data as {
            encryptedItemKey: string;
            ciphertext: string;
          };

          result = await client.updateItem(id, {
            storageMode: "zero_knowledge",
            encryptedItemKey: encrypted.encryptedItemKey,
            ciphertext: encrypted.ciphertext,
            contentVersion: currentItem.contentVersion,
          });
        } else {
          result = await client.updateItem(id, {
            storageMode: "server_managed",
            payload: { v: 1, label, kind: kind as ItemKind, tags: [], fields: { value } },
            contentVersion: currentItem.contentVersion,
          });
        }

        if (opts.json) {
          json(result);
        } else {
          success(`Item ${id} updated (version ${result.contentVersion}).`);
        }
      } catch (err) {
        error(errorMessage(err, "Failed to update item."));
        process.exit(1);
      }
    });

  cmd
    .command("delete")
    .description("Delete a vault item")
    .argument("<id>", "Item ID")
    .option("-f, --force", "Skip confirmation prompt")
    .action(async (id: string, opts: { force?: boolean }) => {
      if (!opts.force) {
        const confirm = await prompt(`Delete item ${id}? (y/N): `);
        if (confirm?.toLowerCase() !== "y") {
          console.log("Cancelled.");
          return;
        }
      }

      const config = requireConfig();
      const client = new ApiClient(config);

      try {
        await client.deleteItem(id);
        success(`Item ${id} deleted.`);
      } catch (err) {
        error(errorMessage(err, "Failed to delete item."));
        process.exit(1);
      }
    });

  await cmd.parseAsync(args, { from: "user" });
}

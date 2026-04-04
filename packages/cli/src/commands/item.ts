import { ITEM_KINDS, type ItemKind } from "@abadge/core";
import type { ItemResult } from "@abadge/sdk";
import { Command } from "commander";
import { clearOperatorSessionIfExpired, createOperatorClient } from "../client";
import { daemonDecrypt, daemonEncrypt } from "../daemon";
import { error, errorMessage, json, success, table } from "../output";
import { prompt } from "../prompt";

async function encryptPayload(payload: {
  v: number;
  label: string;
  kind: string;
  tags: string[];
  fields: { value: string };
}): Promise<{ encryptedItemKey: string; ciphertext: string }> {
  const encRes = await daemonEncrypt(payload);
  if (!encRes.ok || !encRes.data) {
    error(encRes.error ?? "Encryption failed.");
    process.exit(1);
  }
  return encRes.data as { encryptedItemKey: string; ciphertext: string };
}

export function createItemCommand(): Command {
  const cmd = new Command("item").description("Manage vault items");

  cmd
    .command("create")
    .description("Create a new vault item")
    .action(async () => {
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
        const client = await createOperatorClient();
        const encrypted = await encryptPayload({ v: 1, label, kind, tags: [], fields: { value } });
        const result = await client.createItem({
          storageMode: "zero_knowledge",
          encryptedItemKey: encrypted.encryptedItemKey,
          ciphertext: encrypted.ciphertext,
        });
        success("Item created.");
        json(result);
      } catch (err) {
        await clearOperatorSessionIfExpired(err);
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
        const client = await createOperatorClient();
        const items = (await client.listItems()).items;

        if (opts.json) {
          json(items);
          return;
        }

        table(
          items.map((item) => ({
            ID: item.id,
            Storage: item.storageMode,
            Crypto: String(item.cryptoVersion),
            Version: String(item.contentVersion),
            Created: item.createdAt,
          })),
        );
      } catch (err) {
        await clearOperatorSessionIfExpired(err);
        error(errorMessage(err, "Failed to list items."));
        process.exit(1);
      }
    });

  cmd
    .command("get")
    .description("Get a vault item")
    .argument("<id>", "Item ID")
    .action(async (id: string) => {
      try {
        const client = await createOperatorClient();
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
            return;
          } catch {
            error("Cannot decrypt — daemon unavailable. Showing encrypted item.");
          }
        }

        json(item);
      } catch (err) {
        await clearOperatorSessionIfExpired(err);
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
      let client: Awaited<ReturnType<typeof createOperatorClient>>;
      let currentItem: ItemResult["item"];

      try {
        client = await createOperatorClient();
        currentItem = (await client.getItem(id)).item;
      } catch (err) {
        await clearOperatorSessionIfExpired(err);
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
        const payload = { v: 1, label, kind, tags: [] as string[], fields: { value } };
        let result: Awaited<ReturnType<typeof client.updateItem>>;
        if (currentItem.storageMode === "zero_knowledge") {
          const encrypted = await encryptPayload(payload);
          result = await client.updateItem(id, {
            storageMode: "zero_knowledge",
            encryptedItemKey: encrypted.encryptedItemKey,
            ciphertext: encrypted.ciphertext,
            contentVersion: currentItem.contentVersion,
          });
        } else {
          result = await client.updateItem(id, {
            storageMode: "server_managed",
            payload: { ...payload, kind: kind as ItemKind },
            contentVersion: currentItem.contentVersion,
          });
        }

        if (opts.json) {
          json(result);
          return;
        }

        success(`Item ${id} updated (version ${result.contentVersion}).`);
      } catch (err) {
        await clearOperatorSessionIfExpired(err);
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
        const client = await createOperatorClient();
        await client.deleteItem(id);
        success(`Item ${id} deleted.`);
      } catch (err) {
        await clearOperatorSessionIfExpired(err);
        error(errorMessage(err, "Failed to delete item."));
        process.exit(1);
      }
    });

  return cmd;
}

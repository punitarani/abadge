import { parseArgs } from "node:util";
import { ITEM_KINDS, type ItemKind } from "@abadge/core";
import { ApiClient } from "../client";
import { requireConfig } from "../config";
import { daemonDecrypt, daemonEncrypt } from "../daemon";
import { error, errorMessage, json, success, table } from "../output";
import { prompt } from "../prompt";

export async function itemCommand(args: string[]): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "create":
      return itemCreate(args.slice(1));
    case "list":
      return itemList(args.slice(1));
    case "get":
      return itemGet(args.slice(1));
    case "delete":
      return itemDelete(args.slice(1));
    default:
      console.log("Usage: abadge item <create|list|get|delete>");
      process.exit(sub ? 1 : 0);
  }
}

async function itemCreate(_args: string[]): Promise<void> {
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

  // Encrypt via daemon (ZK mode)
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
}

async function itemList(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { json: { type: "boolean" } }, strict: false });
  const config = requireConfig();
  const client = new ApiClient(config);

  try {
    const items = (await client.listItems()).items;

    if (values.json) {
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
}

async function itemGet(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    error("Usage: abadge item get <id>");
    process.exit(1);
  }

  const config = requireConfig();
  const client = new ApiClient(config);

  try {
    const item = (await client.getItem(id)).item;

    // If ZK-encrypted, decrypt via daemon
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
}

async function itemDelete(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    error("Usage: abadge item delete <id>");
    process.exit(1);
  }

  const { values } = parseArgs({
    args,
    options: { force: { type: "boolean", short: "f" } },
    strict: false,
  });

  if (!values.force) {
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
}

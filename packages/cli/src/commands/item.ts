import { parseArgs } from "node:util";
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

async function itemCreate(args: string[]): Promise<void> {
  const config = requireConfig();
  const client = new ApiClient(config);

  const label = await prompt("Label: ");
  const kind = await prompt("Kind (api_key, login, token, json_blob, other): ");
  const value = await prompt("Value (secret): ", true);

  if (!label || !kind || !value) {
    error("Label, kind, and value are required.");
    process.exit(1);
  }

  // Encrypt via daemon (ZK mode)
  let encryptedValue: string;
  try {
    const encRes = await daemonEncrypt(value);
    if (!encRes.ok || !encRes.data) {
      error(encRes.error ?? "Encryption failed.");
      process.exit(1);
    }
    encryptedValue = encRes.data as string;
  } catch (err) {
    error(errorMessage(err, "Failed to encrypt via daemon."));
    process.exit(1);
  }

  try {
    const result = await client.post("/v1/items", {
      name: label,
      type: kind,
      encryptedValue,
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
    const items = await client.get<
      { id: string; name: string; type: string; sourceType: string; createdAt: string; updatedAt: string }[]
    >("/v1/items");

    if (values.json) {
      json(items);
      return;
    }

    table(
      items.map((i) => ({
        ID: i.id,
        Name: i.name,
        Type: i.type,
        Storage: i.sourceType,
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
    const item = await client.get<{
      id: string;
      name: string;
      type: string;
      sourceType: string;
      encryptedValue?: string;
    }>(`/v1/items/${id}`);

    // If ZK-encrypted, decrypt via daemon
    if (item.encryptedValue) {
      try {
        const decRes = await daemonDecrypt(item.encryptedValue);
        if (decRes.ok && decRes.data) {
          const { encryptedValue: _, ...rest } = item;
          json({ ...rest, value: decRes.data as string });
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
    await client.delete(`/v1/items/${id}`);
    success(`Item ${id} deleted.`);
  } catch (err) {
    error(errorMessage(err, "Failed to delete item."));
    process.exit(1);
  }
}

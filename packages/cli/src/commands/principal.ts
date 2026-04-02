import { parseArgs } from "node:util";
import { PRINCIPAL_KINDS, type PrincipalKind } from "@abadge/core";
import { ApiClient } from "../client";
import { requireConfig } from "../config";
import { error, errorMessage, json, str, success, table, warn } from "../output";

export async function principalCommand(args: string[]): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "register":
      return principalRegister(args.slice(1));
    case "list":
      return principalList(args.slice(1));
    case "revoke":
      return principalRevoke(args.slice(1));
    default:
      console.log("Usage: abadge principal <register|list|revoke>");
      process.exit(sub ? 1 : 0);
  }
}

async function principalRegister(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      name: { type: "string", short: "n" },
      kind: { type: "string", short: "k" },
      description: { type: "string", short: "d" },
      json: { type: "boolean" },
    },
    strict: false,
  });

  const name = str(values.name);
  const kind = (str(values.kind) ?? "remote_agent") as PrincipalKind;
  if (!name) {
    error("--name is required.");
    process.exit(1);
  }

  if (!PRINCIPAL_KINDS.includes(kind)) {
    error(`--kind must be one of: ${PRINCIPAL_KINDS.join(", ")}`);
    process.exit(1);
  }

  const config = requireConfig();
  const client = new ApiClient(config);

  try {
    const result = await client.createPrincipal({
      name,
      kind,
      metadata: str(values.description) ? { description: str(values.description) } : {},
    });

    if (values.json) {
      json(result);
    } else {
      success(`Principal "${result.principal.name}" registered (id: ${result.principal.id}).`);
      console.log("");
      warn("Save this API key — it will NOT be shown again:");
      console.log(`  ${result.secret}`);
    }
  } catch (err) {
    error(errorMessage(err, "Failed to register principal."));
    process.exit(1);
  }
}

async function principalList(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { json: { type: "boolean" } }, strict: false });
  const config = requireConfig();
  const client = new ApiClient(config);

  try {
    const principals = (await client.listPrincipals()).principals;

    if (values.json) {
      json(principals);
      return;
    }

    table(
      principals.map((p) => ({
        ID: p.id,
        Name: p.name,
        Kind: p.kind,
        Locality: p.locality,
        Enabled: String(p.enabled && p.revokedAt === null),
        Created: p.createdAt,
      })),
    );
  } catch (err) {
    error(errorMessage(err, "Failed to list principals."));
    process.exit(1);
  }
}

async function principalRevoke(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    error("Usage: abadge principal revoke <id>");
    process.exit(1);
  }

  const config = requireConfig();
  const client = new ApiClient(config);

  try {
    await client.revokePrincipal(id);
    success(`Principal ${id} revoked.`);
  } catch (err) {
    error(errorMessage(err, "Failed to revoke principal."));
    process.exit(1);
  }
}

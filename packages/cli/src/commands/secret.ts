import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { ApiClient } from "../client";
import { requireConfig } from "../config";
import { error, errorMessage, json, str, success, table, warn } from "../output";

interface Credential {
  id: string;
  name: string;
  type: string;
  environment?: string;
  sensitivity?: string;
  service?: string;
  createdAt: string;
  value?: string;
}

export async function secretCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);

  switch (sub) {
    case "create":
      return secretCreate(rest);
    case "list":
    case "ls":
      return secretList(rest);
    case "get":
      return secretGet(rest);
    default:
      error(`Unknown subcommand: ${sub ?? "(none)"}. Use: create, list, get`);
      process.exit(1);
  }
}

async function secretCreate(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      name: { type: "string" },
      type: { type: "string", default: "api_key" },
      value: { type: "string" },
      environment: { type: "string" },
      sensitivity: { type: "string", default: "high" },
      service: { type: "string" },
      "delivery-modes": { type: "string" },
      json: { type: "boolean", default: false },
    },
    strict: false,
  });

  const nameFlag = str(values.name);
  if (!nameFlag) {
    error("--name is required.");
    return process.exit(1) as never;
  }

  let secretValue = str(values.value);
  if (!secretValue) {
    const rl = createInterface({ input: stdin, output: stdout });
    secretValue = await rl.question("Secret value: ");
    rl.close();
  }

  if (!secretValue) {
    error("Secret value is required.");
    return process.exit(1) as never;
  }

  const config = requireConfig();
  const client = new ApiClient(config);

  const body: Record<string, unknown> = {
    name: nameFlag,
    type: str(values.type) ?? "api_key",
    value: secretValue,
  };
  const env = str(values.environment);
  const sens = str(values.sensitivity);
  const svc = str(values.service);
  const modes = str(values["delivery-modes"]);
  if (env) body.environment = env;
  if (sens) body.sensitivity = sens;
  if (svc) body.service = svc;
  if (modes) body.deliveryModes = modes.split(",");

  try {
    const result = await client.post<Credential>("/v1/credentials", body);
    if (values.json) {
      json(result);
    } else {
      success(`Secret "${nameFlag}" created.`);
    }
  } catch (err) {
    error(errorMessage(err, "Failed to create secret."));
    process.exit(1);
  }
}

async function secretList(args: string[]): Promise<void> {
  const jsonOutput = args.includes("--json");
  const config = requireConfig();
  const client = new ApiClient(config);

  try {
    const { credentials } = await client.get<{ credentials: Credential[] }>("/v1/credentials");
    if (jsonOutput) {
      json(credentials);
    } else {
      table(
        credentials.map((c) => ({
          Name: c.name,
          Type: c.type,
          Environment: c.environment ?? "-",
          Sensitivity: c.sensitivity ?? "-",
          Created: c.createdAt,
        })),
      );
    }
  } catch (err) {
    error(errorMessage(err, "Failed to list secrets."));
    process.exit(1);
  }
}

async function secretGet(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      reveal: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const name = positionals[0];
  if (!name) {
    error("Usage: abadge secret get <name> [--reveal]");
    return process.exit(1) as never;
  }

  const config = requireConfig();
  const client = new ApiClient(config);

  try {
    const { credentials } = await client.get<{ credentials: Credential[] }>("/v1/credentials");
    const cred = credentials.find((c) => c.name === name);
    if (!cred) {
      error(`Secret "${name}" not found.`);
      return process.exit(1) as never;
    }

    if (values.reveal) {
      warn("Revealing secret value. Do not share this output.");
      // Reveal requires agent auth — POST /v1/credentials/access with deliveryMode "reveal"
      const revealed = await client.post<{ value?: string; credential?: { name: string } }>(
        "/v1/credentials/access",
        { credentialId: cred.id, deliveryMode: "reveal" },
      );
      if (values.json) {
        json(revealed);
      } else {
        console.log(revealed.value ?? "(empty)");
      }
    } else {
      if (values.json) {
        const { value: _, ...metadata } = cred;
        json(metadata);
      } else {
        table([
          {
            Name: cred.name,
            Type: cred.type,
            Environment: cred.environment ?? "-",
            Sensitivity: cred.sensitivity ?? "-",
            Created: cred.createdAt,
          },
        ]);
      }
    }
  } catch (err) {
    error(errorMessage(err, "Failed to get secret."));
    process.exit(1);
  }
}

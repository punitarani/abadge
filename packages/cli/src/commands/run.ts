import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { type AccessResult, ApiClient } from "../client";
import { requireConfig } from "../config";
import { error, errorMessage, str } from "../output";

export async function runCommand(args: string[]): Promise<void> {
  const sepIndex = args.indexOf("--");
  if (sepIndex === -1) {
    error("Usage: abadge run --secret <name> [--env-var NAME] -- <command> [args...]");
    process.exit(1);
  }

  const cliArgs = args.slice(0, sepIndex);
  const childArgs = args.slice(sepIndex + 1);

  if (childArgs.length === 0) {
    error("No command specified after --");
    process.exit(1);
  }

  const { values } = parseArgs({
    args: cliArgs,
    options: {
      secret: { type: "string" },
      "env-var": { type: "string" },
    },
    strict: false,
  });

  const secretName = str(values.secret);
  if (!secretName) {
    error("--secret is required.");
    process.exit(1);
  }

  const envVarFlag = str(values["env-var"]);
  const envVar = envVarFlag ?? secretName.toUpperCase().replace(/[^A-Z0-9]/g, "_");

  const config = requireConfig();
  const client = new ApiClient(config);

  let secretValue: string;
  try {
    const result = await client.post<AccessResult>("/api/credentials/access", {
      name: secretName,
      deliveryMode: "reveal",
    });
    secretValue = result.value;
  } catch (err) {
    error(errorMessage(err, "Failed to access secret."));
    process.exit(1);
  }

  const cmd = childArgs[0];
  if (!cmd) {
    error("No command specified after --");
    process.exit(1);
  }

  const child = spawn(cmd, childArgs.slice(1), {
    stdio: "inherit",
    env: { ...process.env, [envVar]: secretValue },
  });

  child.on("error", (err) => {
    error(`Failed to spawn: ${err.message}`);
    process.exit(127);
  });

  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });
}

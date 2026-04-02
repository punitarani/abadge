import { parseArgs } from "node:util";
import { ApiClient } from "../client";
import { requireConfig } from "../config";
import { daemonExecEnv } from "../daemon";
import { error, errorMessage, str } from "../output";
import { resolveSecretValue } from "../secret";

export async function runCommand(args: string[]): Promise<void> {
  // Split on -- to get the command to execute
  const dashIdx = args.indexOf("--");
  const cliArgs = dashIdx >= 0 ? args.slice(0, dashIdx) : args;
  const command = dashIdx >= 0 ? args.slice(dashIdx + 1) : [];

  const { values } = parseArgs({
    args: cliArgs,
    options: {
      item: { type: "string" },
    },
    strict: false,
  });

  const itemId = str(values.item);
  if (!itemId) {
    error("--item <id> is required.");
    process.exit(1);
  }

  if (command.length === 0) {
    error("No command specified. Usage: abadge run --item <id> -- <command>");
    process.exit(1);
  }

  const executable = command[0];
  if (!executable) {
    error("No command specified. Usage: abadge run --item <id> -- <command>");
    process.exit(1);
  }

  try {
    const client = new ApiClient(requireConfig());
    const secretValue = await resolveSecretValue(client, itemId, "env");
    const res = await daemonExecEnv(secretValue, "ABADGE_SECRET", executable, command.slice(1));
    if (!res.ok) {
      error(res.error ?? "Failed to run command.");
      process.exit(1);
    }

    // Daemon handles the subprocess and returns exit code
    const exitCode = (res.data as { exitCode?: number })?.exitCode ?? 0;
    process.exit(exitCode);
  } catch (err) {
    error(errorMessage(err, "Failed to communicate with daemon."));
    process.exit(1);
  }
}

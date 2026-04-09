import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { EventEmitter } from "node:events";
import { createWriteStream } from "node:fs";
import { chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { getApiClient } from "../api-client.js";
import type { McpConfig } from "../config.js";
import { resolveSecret } from "../resolve-secret.js";

export const toolName = "run_with_secret";

export const toolDescription =
  "Run a command with a secret injected as an environment variable. Returns only the exit code and a path to the output log. The secret and command output are never returned to the model.";

export const toolInputSchema = z.object({
  itemId: z.string().describe("ID of the item to inject"),
  command: z.string().describe("Command to run"),
  args: z.array(z.string()).optional().describe("Command arguments"),
  envVarName: z
    .string()
    .optional()
    .describe("Environment variable name for the secret (defaults to ABADGE_SECRET)"),
  purpose: z.string().optional().describe("Why this credential is needed"),
});

function runCommand(
  command: string,
  args: string[],
  env: Record<string, string | undefined>,
  logFile: string,
): Promise<{ exitCode: number }> {
  return new Promise((resolve) => {
    const logStream = createWriteStream(logFile, { flags: "w", mode: 0o600 });
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });

    child.stdout?.pipe(logStream, { end: false });
    child.stderr?.pipe(logStream, { end: false });

    (child as unknown as EventEmitter).on("error", (err: Error) => {
      logStream.write(`[spawn error] ${err.message}\n`, () => logStream.end());
      resolve({ exitCode: 1 });
    });
    (child as unknown as EventEmitter).on("close", (code: number | null) => {
      logStream.end();
      resolve({ exitCode: code ?? 1 });
    });
  });
}

export async function handler(
  input: z.infer<typeof toolInputSchema>,
  config: McpConfig,
): Promise<string> {
  const client = await getApiClient(config);
  const secret = await resolveSecret(client, input.itemId, "env");

  const envVarName = input.envVarName ?? "ABADGE_SECRET";
  const childEnv = { ...globalThis.process?.env, [envVarName]: secret };

  const suffix = randomBytes(8).toString("hex");
  const logFile = join(tmpdir(), `abadge-run-${suffix}.log`);

  const result = await runCommand(input.command, input.args ?? [], childEnv, logFile);
  await chmod(logFile, 0o600);

  return JSON.stringify({ exitCode: result.exitCode, logFile });
}

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { EventEmitter } from "node:events";
import { createWriteStream } from "node:fs";
import { chmod, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { getApiClient } from "../api-client.js";
import type { McpConfig } from "../config.js";
import { resolveSecret } from "../resolve-secret.js";

export const toolName = "run_with_secret";

export const toolDescription =
  "Run a command with a secret injected as an environment variable. Returns only the exit code and a path to the output log. The secret and command output are never returned to the model. The log file is auto-deleted after 5 minutes.";

export const toolInputSchema = z.object({
  itemId: z.string().describe("ID of the item to inject"),
  field: z.string().optional().describe("Named field to inject from the item payload"),
  command: z.string().describe("Command to run"),
  args: z.array(z.string()).optional().describe("Command arguments"),
  envVarName: z
    .string()
    .optional()
    .describe("Environment variable name for the secret (defaults to ABADGE_SECRET)"),
  purpose: z.string().optional().describe("Why this credential is needed"),
});

const RUN_LOG_TTL_MS = 5 * 60 * 1000;

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

    let settled = false;
    const finish = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      logStream.end(() => {
        resolve({ exitCode });
      });
    };

    (child as unknown as EventEmitter).on("error", (err: Error) => {
      logStream.write(`[spawn error] ${err.message}\n`, () => {
        finish(1);
      });
    });
    (child as unknown as EventEmitter).on("close", (code: number | null) => {
      finish(code ?? 1);
    });
  });
}

export async function handler(
  input: z.infer<typeof toolInputSchema>,
  config: McpConfig,
): Promise<string> {
  const client = await getApiClient(config);
  const secret = await resolveSecret(client, input.itemId, "env", input.field);

  const envVarName = input.envVarName ?? "ABADGE_SECRET";
  const childEnv = { ...globalThis.process?.env, [envVarName]: secret };

  const suffix = randomBytes(8).toString("hex");
  const logFile = join(tmpdir(), `abadge-run-${suffix}.log`);

  const result = await runCommand(input.command, input.args ?? [], childEnv, logFile);
  await chmod(logFile, 0o600);

  setTimeout(() => {
    void unlink(logFile).catch(() => {});
  }, RUN_LOG_TTL_MS);

  return JSON.stringify({ exitCode: result.exitCode, logFile });
}

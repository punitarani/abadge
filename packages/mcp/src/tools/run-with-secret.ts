import { spawn } from "node:child_process";
import type { EventEmitter } from "node:events";
import { z } from "zod";
import { getApiClient } from "../api-client.js";
import type { McpConfig } from "../config.js";
import { resolveSecret } from "../resolve-secret.js";

export const toolName = "run_with_secret";

export const toolDescription =
  "Run a command with a secret injected as an environment variable. The secret is never exposed to the AI model — only stdout/stderr (max 4KB) are returned.";

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

const MAX_OUTPUT_BYTES = 4096;

function truncate(str: string): string {
  if (str.length <= MAX_OUTPUT_BYTES) return str;
  return `${str.slice(0, MAX_OUTPUT_BYTES)}...[truncated]`;
}

function runCommand(
  command: string,
  args: string[],
  env: Record<string, string | undefined>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk.toString();
    });
    (child as unknown as EventEmitter).on("error", (err: Error) => {
      resolve({ exitCode: 1, stdout: "", stderr: err.message });
    });
    (child as unknown as EventEmitter).on("close", (code: number | null) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

export async function handler(
  input: z.infer<typeof toolInputSchema>,
  config: McpConfig,
): Promise<string> {
  const client = getApiClient(config);
  const secret = await resolveSecret(client, input.itemId, "env");

  const envVarName = input.envVarName ?? "ABADGE_SECRET";
  const childEnv = { ...globalThis.process?.env, [envVarName]: secret };

  const result = await runCommand(input.command, input.args ?? [], childEnv);

  // Never return the secret, only command output
  return JSON.stringify({
    exitCode: result.exitCode,
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
  });
}

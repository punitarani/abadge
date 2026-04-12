import { spawn } from "node:child_process";
import { z } from "zod";
import { getApiClient } from "../api-client.js";
import type { McpConfig } from "../config.js";
import { resolveSecret } from "../resolve-secret.js";

export const toolName = "run_with_secret";

export const toolDescription =
  "Run a command with a secret injected as an environment variable. Returns the exit code, captured output lines (truncated to 4KB total, with secret values replaced by [REDACTED]), and a truncation flag. No file paths or secret content are returned to the model.";

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

const MAX_OUTPUT_BYTES = 4 * 1024;

function redactSecret(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join("[REDACTED]");
}

function truncateOutput(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= maxBytes) return { text, truncated: false };
  const buf = Buffer.from(text, "utf8").subarray(0, maxBytes);
  return { text: buf.toString("utf8"), truncated: true };
}

function runCommand(
  command: string,
  args: string[],
  env: Record<string, string | undefined>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });

    const stdoutChunks: Uint8Array[] = [];
    const stderrChunks: Uint8Array[] = [];

    child.stdout?.on("data", (chunk: Uint8Array) => {
      stdoutChunks.push(chunk);
    });
    child.stderr?.on("data", (chunk: Uint8Array) => {
      stderrChunks.push(chunk);
    });

    let settled = false;
    const finish = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      resolve({
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    };

    child.on("error", (err: Error) => {
      stderrChunks.push(Buffer.from(`[spawn error] ${err.message}\n`));
      finish(1);
    });
    child.on("close", (code: number | null) => {
      finish(code ?? 1);
    });
  });
}

export async function handler(
  input: z.infer<typeof toolInputSchema>,
  config: McpConfig,
): Promise<string> {
  const client = await getApiClient(config);
  const secret = await resolveSecret(client, input.itemId, "env", input.field, input.purpose);

  const envVarName = input.envVarName ?? "ABADGE_SECRET";
  const childEnv = { ...globalThis.process?.env, [envVarName]: secret };

  const { exitCode, stdout, stderr } = await runCommand(input.command, input.args ?? [], childEnv);

  // Allocate the 4KB budget: stdout gets first priority, stderr gets the remainder
  const stdoutTruncated = truncateOutput(redactSecret(stdout, secret), MAX_OUTPUT_BYTES);
  const remainingBytes = MAX_OUTPUT_BYTES - Buffer.byteLength(stdoutTruncated.text, "utf8");
  const stderrTruncated = truncateOutput(redactSecret(stderr, secret), Math.max(0, remainingBytes));

  return JSON.stringify({
    exitCode,
    stdoutLines: stdoutTruncated.text.split("\n"),
    stderrLines: stderrTruncated.text.split("\n"),
    truncated: stdoutTruncated.truncated || stderrTruncated.truncated,
  });
}

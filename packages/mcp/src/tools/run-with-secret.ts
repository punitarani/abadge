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

export const MAX_OUTPUT_BYTES = 4 * 1024;
// Per-stream pre-redaction cap. Two-KB of headroom above the post-redaction
// cap lets redactSecret still see the full final window even after replacements
// shrink the buffer, and prevents a misbehaving subprocess from OOMing the
// MCP process by flooding stdout/stderr (DoS vector from any agent with the
// run_with_secret capability).
export const PRE_REDACT_CAP_BYTES = MAX_OUTPUT_BYTES * 2;

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

/**
 * Captures a chunk stream into a bounded buffer. Drops further chunks (or
 * partial chunks) once `capBytes` is reached. Returns the accumulated buffer
 * and a flag indicating whether any data was dropped.
 */
class BoundedCapture {
  readonly chunks: Uint8Array[] = [];
  private bytes = 0;
  truncated = false;
  constructor(private readonly capBytes: number) {}

  push(chunk: Uint8Array): void {
    if (this.bytes >= this.capBytes) {
      this.truncated = true;
      return;
    }
    const room = this.capBytes - this.bytes;
    if (chunk.byteLength > room) {
      this.chunks.push(chunk.subarray(0, room));
      this.bytes = this.capBytes;
      this.truncated = true;
      return;
    }
    this.chunks.push(chunk);
    this.bytes += chunk.byteLength;
  }

  toString(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

export function runCommand(
  command: string,
  args: string[],
  env: Record<string, string | undefined>,
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    // Bun's ChildProcess type omits EventEmitter methods; cast for .on() access
    const proc = child as unknown as {
      on(event: string, listener: (...args: unknown[]) => void): void;
    };

    const stdoutCapture = new BoundedCapture(PRE_REDACT_CAP_BYTES);
    const stderrCapture = new BoundedCapture(PRE_REDACT_CAP_BYTES);

    child.stdout?.on("data", (chunk: Uint8Array) => {
      stdoutCapture.push(chunk);
    });
    child.stderr?.on("data", (chunk: Uint8Array) => {
      stderrCapture.push(chunk);
    });

    let settled = false;
    const finish = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      resolve({
        exitCode,
        stdout: stdoutCapture.toString(),
        stderr: stderrCapture.toString(),
        stdoutTruncated: stdoutCapture.truncated,
        stderrTruncated: stderrCapture.truncated,
      });
    };

    proc.on("error", (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      stderrCapture.push(new TextEncoder().encode(`[spawn error] ${msg}\n`));
      finish(1);
    });
    proc.on("close", (code: unknown) => {
      finish(typeof code === "number" ? code : 1);
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

  const { exitCode, stdout, stderr, stdoutTruncated, stderrTruncated } = await runCommand(
    input.command,
    input.args ?? [],
    childEnv,
  );

  // Allocate the 4KB budget: stdout gets first priority, stderr gets the remainder
  const stdoutFinal = truncateOutput(redactSecret(stdout, secret), MAX_OUTPUT_BYTES);
  const remainingBytes = MAX_OUTPUT_BYTES - Buffer.byteLength(stdoutFinal.text, "utf8");
  const stderrFinal = truncateOutput(redactSecret(stderr, secret), Math.max(0, remainingBytes));

  return JSON.stringify({
    exitCode,
    stdoutLines: stdoutFinal.text.split("\n"),
    stderrLines: stderrFinal.text.split("\n"),
    truncated: stdoutTruncated || stderrTruncated || stdoutFinal.truncated || stderrFinal.truncated,
  });
}

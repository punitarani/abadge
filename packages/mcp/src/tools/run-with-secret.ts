import { spawn } from "node:child_process";
import { validateEnvVarName } from "@abadge/core";
import { z } from "zod";
import { getApiClient } from "../api-client.js";
import type { McpConfig } from "../config.js";
import { resolveSecret } from "../resolve-secret.js";

export const toolName = "run_with_secret";

export const toolDescription =
  "Run a command with a secret injected as an environment variable. Returns only the exit code, duration, output-line count, and a truncation flag. Subprocess stdout/stderr text is NOT returned to the model — use a separate audited channel (write to a file via mount_secret, then read back via list_items if needed) if output inspection is required. Secrets larger than 4KB are rejected — use mount_secret instead.";

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
// Per-stream capture cap. Prevents a misbehaving subprocess from OOMing the
// MCP process by flooding stdout/stderr (DoS vector from any agent with the
// run_with_secret capability). Output is NOT forwarded to the model — only
// the line count and truncation flag are returned.
export const STREAM_CAP_BYTES = MAX_OUTPUT_BYTES * 2;

/**
 * Build the child process env, stripping abadge-private vars so the
 * spawned command cannot read session tokens / API keys out of its
 * inherited environment (mirrors the daemon's COMPOSITE-001 fix).
 */
export function buildChildEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  const procEnv = globalThis.process?.env ?? {};
  for (const [k, v] of Object.entries(procEnv)) {
    if (!k.startsWith("ABADGE_")) env[k] = v;
  }
  return env;
}

export function countLines(text: string): number {
  if (text.length === 0) return 0;
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  return trimmed.split("\n").length;
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

    const stdoutCapture = new BoundedCapture(STREAM_CAP_BYTES);
    const stderrCapture = new BoundedCapture(STREAM_CAP_BYTES);

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
  const startMs = Date.now();
  const client = await getApiClient(config);
  const secret = await resolveSecret(client, input.itemId, "env", input.field, input.purpose);

  // Reject large credentials. run_with_secret is env-var injection, not a bulk
  // data channel. Large secrets (PEMs, kubeconfigs, TLS certs) belong in
  // mount_secret (filesystem delivery).
  const secretByteLength = Buffer.byteLength(secret, "utf8");
  if (secretByteLength > MAX_OUTPUT_BYTES) {
    throw new Error(
      `Secret is ${secretByteLength} bytes but run_with_secret only accepts secrets ≤ ${MAX_OUTPUT_BYTES} bytes. ` +
        `Use mount_secret (filesystem delivery) for large secrets instead.`,
    );
  }

  const envVarName = input.envVarName ?? "ABADGE_SECRET";

  // Reject reserved env vars (RESERVED_ENV_KEYS shared with daemon's exec.env
  // blocklist — same loader/runtime escalation surface). Also rejects malformed
  // names (not matching POSIX [A-Z_][A-Z0-9_]*).
  const envVarValidation = validateEnvVarName(envVarName);
  if (!envVarValidation.ok) {
    if (envVarValidation.reason === "reserved") {
      throw new Error(`Refusing to inject secret into reserved env var: ${envVarName}`);
    }
    throw new Error(`Invalid env var name: ${envVarName}. Must match /^[A-Z_][A-Z0-9_]*$/.`);
  }

  const childEnv = { ...buildChildEnv(), [envVarName]: secret };

  const { exitCode, stdout, stderr, stdoutTruncated, stderrTruncated } = await runCommand(
    input.command,
    input.args ?? [],
    childEnv,
  );

  // stdout/stderr text is NOT forwarded to the model. Only line counts and
  // the truncation flag are returned so the model can tell whether the command
  // produced output without being able to read it. This eliminates all
  // semantic-leakage vectors (base64, hex, URL-encoded, nth-char, etc.) that
  // string-based redaction cannot catch (§RED1).
  return JSON.stringify({
    exitCode,
    durationMs: Date.now() - startMs,
    outputLineCount: {
      stdout: countLines(stdout),
      stderr: countLines(stderr),
    },
    truncated: stdoutTruncated || stderrTruncated,
  });
}

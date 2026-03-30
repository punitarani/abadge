import { spawn } from "node:child_process";
import { z } from "zod";
import { apiPost } from "../api-client.js";
import type { McpConfig } from "../config.js";

export const toolName = "run_with_secret";

export const toolDescription =
  "Run a command with a credential injected as an environment variable. The secret is never exposed to the AI model.";

export const toolInputSchema = z.object({
  credentialName: z.string().describe("Name of the credential to inject"),
  command: z.string().describe("Command to run"),
  args: z.array(z.string()).optional().describe("Command arguments"),
  envVarName: z
    .string()
    .optional()
    .describe("Environment variable name for the secret (defaults to ABADGE_SECRET)"),
  purpose: z.string().optional().describe("Why this credential is needed"),
});

const MAX_OUTPUT_BYTES = 4096;

interface AccessResponse {
  credential?: { name: string; type: string; value: string };
  error?: string;
}

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

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk.toString();
    });
    // @ts-expect-error -- Bun's ChildProcessByStdio type lacks .on() but the runtime supports it
    child.on("error", (err: Error) => {
      resolve({ exitCode: 1, stdout: "", stderr: err.message });
    });
    // @ts-expect-error -- Bun's ChildProcessByStdio type lacks .on() but the runtime supports it
    child.on("close", (code: number | null) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

export async function handler(
  input: z.infer<typeof toolInputSchema>,
  config: McpConfig,
): Promise<string> {
  // Fetch the secret server-side
  const res = await apiPost<AccessResponse>(config, "/api/v1/credentials/access", {
    credentialName: input.credentialName,
    purpose: input.purpose ?? `Run command: ${input.command}`,
  });

  if (!res.ok || !res.data.credential?.value) {
    return JSON.stringify({
      error: res.data.error ?? "Failed to access credential",
    });
  }

  const envVarName = input.envVarName ?? "ABADGE_SECRET";
  const childEnv = { ...globalThis.process?.env, [envVarName]: res.data.credential.value };

  const result = await runCommand(input.command, input.args ?? [], childEnv);

  // Never return the secret, only command output
  return JSON.stringify({
    exitCode: result.exitCode,
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
  });
}

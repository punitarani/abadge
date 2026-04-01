import { spawn } from "node:child_process";
import type { RunResult } from "./types";

/**
 * Spawn a subprocess with a secret injected as an environment variable.
 * The secret is passed in-memory and never written to disk.
 */
export function runWithEnv(params: {
  secretValue: string;
  envVar: string;
  command: string;
  args: string[];
}): Promise<RunResult> {
  const { secretValue, envVar, command, args } = params;
  const childEnv = { ...process.env, [envVar]: secretValue };

  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(command, args, {
      env: childEnv,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code: number | null, signal: string | null) => {
      resolve({
        exitCode: code ?? 1,
        signal: signal ?? undefined,
      });
    });
  });
}

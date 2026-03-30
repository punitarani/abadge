import { spawn } from "node:child_process";
import type { AbadgeClient } from "./client";
import type { RunResult } from "./types";

function toEnvVarName(secretName: string): string {
  return secretName.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
}

export async function runWithSecret(params: {
  client: AbadgeClient;
  secretName: string;
  envVarName?: string;
  command: string;
  args: string[];
  deliveryMode?: string;
  purpose?: string;
}): Promise<RunResult> {
  const { client, secretName, command, args, purpose } = params;
  const deliveryMode = params.deliveryMode ?? "env_inject";
  const envVarName = params.envVarName ?? toEnvVarName(secretName);

  const result = await client.accessSecret({
    credentialName: secretName,
    deliveryMode,
    purpose,
  });

  if (!result.value) {
    throw new Error(`No secret value returned for "${secretName}"`);
  }

  const childEnv = { ...process.env, [envVarName]: result.value };

  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(command, args, {
      env: childEnv,
      stdio: ["inherit", "inherit", "inherit"],
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({
        exitCode: code ?? 1,
        signal: signal ?? undefined,
      });
    });
  });
}

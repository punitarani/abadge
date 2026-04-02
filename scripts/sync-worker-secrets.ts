import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SECRET_KEY_PATTERN = /^[A-Z0-9_]+$/;

export function parseRequiredSecretsFromWranglerConfig(text: string): string[] {
  const match = text.match(/"secrets"\s*:\s*\{[\s\S]*?"required"\s*:\s*\[([\s\S]*?)\]/);
  if (!match?.[1]) {
    throw new Error('Could not parse "secrets.required" from Wrangler config');
  }

  const seen = new Set<string>();
  const keys = [...match[1].matchAll(/"([A-Z0-9_]+)"/g)].map(([, key]) => key);

  if (keys.length === 0) {
    throw new Error('Wrangler config "secrets.required" is empty');
  }

  return keys.map((key) => {
    if (!SECRET_KEY_PATTERN.test(key)) {
      throw new Error(`Invalid worker secret key "${key}"`);
    }

    if (seen.has(key)) {
      throw new Error(`Duplicate worker secret key "${key}"`);
    }

    seen.add(key);
    return key;
  });
}

export function buildSecretPayload(
  env: Record<string, string | undefined>,
  requiredKeys: string[],
): Record<string, string> {
  const payload: Record<string, string> = {};
  const missing: string[] = [];

  for (const key of requiredKeys) {
    const value = env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      payload[key] = value;
      continue;
    }

    missing.push(key);
  }

  if (missing.length > 0) {
    throw new Error(`Missing required worker secrets in environment: ${missing.join(", ")}`);
  }

  return payload;
}

type CliOptions = {
  config: string;
};

export function parseCliArgs(args: string[]): CliOptions {
  let config = "";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--config") {
      config = args[index + 1] ?? "";
      index += 1;
    }
  }

  if (!config) {
    throw new Error("Usage: bun scripts/sync-worker-secrets.ts --config <path>");
  }

  return { config };
}

export async function syncWorkerSecrets(options: CliOptions): Promise<void> {
  const configPath = resolve(options.config);
  const requiredKeys = parseRequiredSecretsFromWranglerConfig(readFileSync(configPath, "utf8"));
  const payload = buildSecretPayload(Bun.env, requiredKeys);
  const secretCount = Object.keys(payload).length;

  if (secretCount === 0) {
    throw new Error("No worker secrets resolved for sync");
  }

  console.log(`Syncing ${secretCount} worker secret${secretCount === 1 ? "" : "s"} from Doppler`);

  const wrangler = Bun.spawn(["wrangler", "secret", "bulk", "--config", configPath], {
    stdin: "pipe",
    stdout: "inherit",
    stderr: "inherit",
  });

  wrangler.stdin.write(JSON.stringify(payload));
  wrangler.stdin.end();

  const exitCode = await wrangler.exited;
  if (exitCode !== 0) {
    throw new Error(`wrangler secret bulk failed with exit code ${exitCode}`);
  }
}

if (import.meta.main) {
  await syncWorkerSecrets(parseCliArgs(Bun.argv.slice(2)));
}

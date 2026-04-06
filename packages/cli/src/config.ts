import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CliConfig {
  apiUrl: string;
  sessionCookie?: string;
  principalId?: string;
  principalSecret?: string;
  /** Legacy alias used by older CLI/MCP config readers. */
  authToken?: string;
}

const CONFIG_DIR = join(homedir(), ".abadge");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

function normalizeConfig(config: Partial<CliConfig>): CliConfig | null {
  const apiUrl = typeof config.apiUrl === "string" && config.apiUrl ? config.apiUrl : undefined;
  if (!apiUrl) {
    return null;
  }

  const principalSecret =
    typeof config.principalSecret === "string" && config.principalSecret
      ? config.principalSecret
      : typeof config.authToken === "string" && config.authToken
        ? config.authToken
        : undefined;

  return {
    apiUrl,
    sessionCookie:
      typeof config.sessionCookie === "string" && config.sessionCookie
        ? config.sessionCookie
        : undefined,
    principalId:
      typeof config.principalId === "string" && config.principalId ? config.principalId : undefined,
    principalSecret,
    authToken: principalSecret,
  };
}

export function loadConfig(): CliConfig | null {
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as Partial<CliConfig>;
    return normalizeConfig(parsed);
  } catch {
    return null;
  }
}

export function saveConfig(config: CliConfig): void {
  const normalized = normalizeConfig(config);
  if (!normalized) {
    throw new Error("apiUrl is required");
  }

  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(
    CONFIG_PATH,
    JSON.stringify(
      {
        apiUrl: normalized.apiUrl,
        sessionCookie: normalized.sessionCookie,
        principalId: normalized.principalId,
        principalSecret: normalized.principalSecret,
        authToken: normalized.principalSecret,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}

export function clearConfig(): void {
  try {
    rmSync(CONFIG_PATH);
  } catch {
    // File doesn't exist — nothing to clear
  }
}

export function requireConfig(): CliConfig {
  const config = loadConfig();
  if (!config) {
    console.error("Not logged in. Run `abadge login` first.");
    return process.exit(1) as never;
  }
  return config;
}

export type SessionConfig = CliConfig & { sessionCookie: string };

export function requireSessionConfig(): SessionConfig {
  const config = requireConfig();
  if (!config.sessionCookie) {
    console.error("No session found. Run `abadge login` first.");
    return process.exit(1) as never;
  }
  return { ...config, sessionCookie: config.sessionCookie };
}

export type PrincipalConfig = CliConfig & { principalId: string; principalSecret: string };

export function requirePrincipalConfig(): PrincipalConfig {
  const config = requireConfig();
  if (!config.principalId || !config.principalSecret) {
    console.error("No local CLI principal configured. Run `abadge login` first.");
    return process.exit(1) as never;
  }
  return {
    ...config,
    principalId: config.principalId,
    principalSecret: config.principalSecret,
    authToken: config.principalSecret,
  };
}

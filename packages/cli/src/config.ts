import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CliConfig {
  apiUrl: string;
  principalId?: string;
  principalSecret?: string;
  operatorUserId?: string;
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
    principalId:
      typeof config.principalId === "string" && config.principalId ? config.principalId : undefined,
    principalSecret,
    operatorUserId:
      typeof config.operatorUserId === "string" && config.operatorUserId
        ? config.operatorUserId
        : undefined,
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
        principalId: normalized.principalId,
        principalSecret: normalized.principalSecret,
        operatorUserId: normalized.operatorUserId,
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

export type SessionConfig = CliConfig & { sessionHeaders: Record<string, string> };

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

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CliConfig {
  apiUrl: string;
  activeOrgId?: string;
  activeProfileId?: string;
  /** Legacy local agent config (will be removed when agent register is done). */
  principalId?: string;
  principalSecret?: string;
  operatorUserId?: string;
  /** Legacy alias used by older CLI/MCP config readers. */
  authToken?: string;
}

const CONFIG_DIR = join(homedir(), ".abadge");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function normalizeConfig(config: Partial<CliConfig>): CliConfig | null {
  const apiUrl = str(config.apiUrl);
  if (!apiUrl) {
    return null;
  }

  const principalSecret = str(config.principalSecret) ?? str(config.authToken);

  return {
    apiUrl,
    activeOrgId: str(config.activeOrgId),
    activeProfileId: str(config.activeProfileId),
    principalId: str(config.principalId),
    principalSecret,
    operatorUserId: str(config.operatorUserId),
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

function writeConfig(normalized: CliConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(
    CONFIG_PATH,
    JSON.stringify(
      {
        apiUrl: normalized.apiUrl,
        activeOrgId: normalized.activeOrgId,
        activeProfileId: normalized.activeProfileId,
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

/** Save a full config, replacing the existing file entirely. */
export function saveConfig(config: CliConfig): void {
  const normalized = normalizeConfig(config);
  if (!normalized) {
    throw new Error("apiUrl is required");
  }
  writeConfig(normalized);
}

/** Merge a partial patch over the existing config and save. */
export function updateConfig(patch: Partial<CliConfig>): void {
  const existing = loadConfig() ?? {};
  const merged: Partial<CliConfig> = { ...existing, ...patch };
  const normalized = normalizeConfig(merged);
  if (!normalized) {
    throw new Error("apiUrl is required");
  }
  writeConfig(normalized);
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

export function requireActiveOrgId(): string {
  const config = requireConfig();
  if (!config.activeOrgId) {
    console.error("No active organization. Run `abadge org use <id-or-slug>` first.");
    return process.exit(1) as never;
  }
  return config.activeOrgId;
}

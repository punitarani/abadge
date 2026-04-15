import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface LocalAgentConfig {
  agentId: string;
  privateKeyPath: string;
}

export interface CliConfig {
  apiUrl: string;
  activeOrgId?: string;
  activeProfileId?: string;
  localAgents?: {
    cli?: LocalAgentConfig;
    mcp?: LocalAgentConfig;
  };
}

const CONFIG_DIR = join(homedir(), ".abadge");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

const LEGACY_FIELDS = ["principalId", "principalSecret", "operatorUserId", "authToken"] as const;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function normalizeConfig(config: Record<string, unknown>): CliConfig | null {
  const apiUrl = str(config.apiUrl);
  if (!apiUrl) {
    return null;
  }

  return {
    apiUrl,
    activeOrgId: str(config.activeOrgId),
    activeProfileId: str(config.activeProfileId),
    localAgents: config.localAgents as CliConfig["localAgents"],
  };
}

function stripLegacyFields(parsed: Record<string, unknown>): boolean {
  let touched = false;
  for (const key of LEGACY_FIELDS) {
    if (key in parsed) {
      delete parsed[key];
      touched = true;
    }
  }
  return touched;
}

export function loadConfig(): CliConfig | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }

  const hadLegacy = stripLegacyFields(parsed);
  const normalized = normalizeConfig(parsed);

  if (hadLegacy && normalized) {
    console.warn(
      "[abadge] Legacy principal*/operator-token keys detected in ~/.abadge/config.json; clearing. Re-run `abadge login` and `abadge agent register --kind local_cli` to re-enroll.",
    );
    writeConfig(normalized);
  }

  return normalized;
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
        localAgents: normalized.localAgents,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}

/** Save a full config, replacing the existing file entirely. */
export function saveConfig(config: CliConfig): void {
  const normalized = normalizeConfig(config as unknown as Record<string, unknown>);
  if (!normalized) {
    throw new Error("apiUrl is required");
  }
  writeConfig(normalized);
}

/** Merge a partial patch over the existing config and save. */
export function updateConfig(patch: Partial<CliConfig>): void {
  const existing = loadConfig() ?? {};
  const merged = { ...existing, ...patch } as Record<string, unknown>;
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

export function requireActiveOrgId(): string {
  const config = requireConfig();
  if (!config.activeOrgId) {
    console.error("No active organization. Run `abadge org use <id-or-slug>` first.");
    return process.exit(1) as never;
  }
  return config.activeOrgId;
}

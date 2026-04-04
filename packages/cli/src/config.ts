import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CliLocalAgentReference, CliProfileConfig } from "@abadge/core";

export type { CliLocalAgentReference, CliProfileConfig } from "@abadge/core";

export type LocalAgentSlot = "cli" | "mcp";

export const DEFAULT_API_URL = "https://api.abadge.dev";

const CONFIG_DIR = join(homedir(), ".abadge");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

interface ParsedConfigState {
  config: CliProfileConfig | null;
  legacyTokenDetected: boolean;
}

function parseLocalAgentReference(value: unknown): CliLocalAgentReference | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.agentId !== "string" || typeof record.privateKeyPath !== "string") {
    return undefined;
  }

  return {
    agentId: record.agentId,
    privateKeyPath: record.privateKeyPath,
  };
}

function parseConfig(raw: unknown): ParsedConfigState {
  if (!raw || typeof raw !== "object") {
    return { config: null, legacyTokenDetected: false };
  }

  const parsed = raw as Record<string, unknown>;
  const apiUrl = typeof parsed.apiUrl === "string" ? parsed.apiUrl : null;
  if (!apiUrl) {
    return {
      config: null,
      legacyTokenDetected: typeof parsed.token === "string" || typeof parsed.authToken === "string",
    };
  }

  const localAgentsRaw =
    parsed.localAgents && typeof parsed.localAgents === "object"
      ? (parsed.localAgents as Record<string, unknown>)
      : null;
  const cli = parseLocalAgentReference(localAgentsRaw?.cli);
  const mcp = parseLocalAgentReference(localAgentsRaw?.mcp);

  return {
    config: {
      apiUrl,
      ...(typeof parsed.profileName === "string" ? { profileName: parsed.profileName } : {}),
      ...(cli || mcp ? { localAgents: { ...(cli ? { cli } : {}), ...(mcp ? { mcp } : {}) } } : {}),
    },
    legacyTokenDetected: typeof parsed.token === "string" || typeof parsed.authToken === "string",
  };
}

function loadConfigState(): ParsedConfigState {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as unknown;
    const parsed = parseConfig(raw);

    // Remove deprecated persisted bearer material as soon as it is observed.
    if (parsed.config && parsed.legacyTokenDetected) {
      saveConfig(parsed.config);
    }

    return parsed;
  } catch {
    return { config: null, legacyTokenDetected: false };
  }
}

export function loadConfig(): CliProfileConfig | null {
  return loadConfigState().config;
}

export function saveConfig(config: CliProfileConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function updateConfig(
  updater: (config: CliProfileConfig) => CliProfileConfig,
): CliProfileConfig {
  const next = updater(loadConfig() ?? { apiUrl: DEFAULT_API_URL });
  saveConfig(next);
  return next;
}

export function getLocalAgentReference(
  config: CliProfileConfig,
  slot: LocalAgentSlot,
): CliLocalAgentReference | undefined {
  return config.localAgents?.[slot];
}

export function saveLocalAgentReference(
  slot: LocalAgentSlot,
  reference: CliLocalAgentReference,
  baseConfig?: CliProfileConfig,
): CliProfileConfig {
  const current = baseConfig ?? loadConfig() ?? { apiUrl: DEFAULT_API_URL };
  const next: CliProfileConfig = {
    ...current,
    localAgents: {
      ...(current.localAgents ?? {}),
      [slot]: reference,
    },
  };
  saveConfig(next);
  return next;
}

export function clearConfig(): void {
  try {
    rmSync(CONFIG_PATH);
  } catch {
    // File doesn't exist.
  }
}

export function requireConfig(): CliProfileConfig {
  const state = loadConfigState();
  if (!state.config) {
    if (state.legacyTokenDetected) {
      console.error("Stored CLI bearer tokens are no longer used. Run `abadge login` again.");
    } else {
      console.error("CLI is not configured. Run `abadge login` first.");
    }
    return process.exit(1) as never;
  }

  return state.config;
}

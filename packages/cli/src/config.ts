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
  /**
   * SHA-256 fingerprint of the daemon's Ed25519 public key, pinned on first
   * contact (W3P12-001 / Critical C-2). A later mismatch means the daemon
   * regenerated its keypair OR a same-UID attacker is squatting the socket —
   * the CLI aborts before writing any sensitive RPC frame.
   */
  daemonFingerprint?: string;
}

// Resolve at call time, not at module load. This keeps tests honest: a test
// can swap `process.env.HOME` after the module is imported and have it take
// effect. (homedir() ignores HOME on Linux/macOS by design — `os.homedir()`
// reads `getpwuid(2)` first — but resolving the dir lazily means we don't
// have to mock node:os just to use a tmpdir per test.)
function getConfigDir(): string {
  // biome-ignore lint/style/noRestrictedGlobals: the cli config helper resolves $HOME at call time so tests can redirect to a tmpdir
  const home = process.env.HOME ?? homedir();
  return join(home, ".abadge");
}
function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

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
    daemonFingerprint: str(config.daemonFingerprint),
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
    parsed = JSON.parse(readFileSync(getConfigPath(), "utf-8")) as Record<string, unknown>;
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
  mkdirSync(getConfigDir(), { recursive: true, mode: 0o700 });
  writeFileSync(
    getConfigPath(),
    JSON.stringify(
      {
        apiUrl: normalized.apiUrl,
        activeOrgId: normalized.activeOrgId,
        activeProfileId: normalized.activeProfileId,
        localAgents: normalized.localAgents,
        daemonFingerprint: normalized.daemonFingerprint,
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
    rmSync(getConfigPath());
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

/**
 * Read the pinned daemon fingerprint (W3P12-001 / Critical C-2). Returns
 * `null` for a first-run client or when the config file doesn't exist yet —
 * the DaemonClient then pins TOFU-style.
 */
export async function readPinnedDaemonFingerprint(): Promise<string | null> {
  const config = loadConfig();
  return config?.daemonFingerprint ?? null;
}

/**
 * Persist the daemon fingerprint on first contact. Creates the config with a
 * sensible apiUrl default if none exists — otherwise the handshake would fail
 * the very first time the user runs `abadge daemon start` before `abadge
 * login`. Callers supply a fallback `apiUrl` when they know it.
 */
export async function writePinnedDaemonFingerprint(
  fingerprint: string,
  fallbackApiUrl?: string,
): Promise<void> {
  const existing = loadConfig();
  if (existing) {
    updateConfig({ daemonFingerprint: fingerprint });
    return;
  }
  if (!fallbackApiUrl) {
    // No config file + no apiUrl means the caller is pre-login (e.g. just
    // started the daemon). Skip persistence — we'll re-pin on the first
    // sensitive call after login, which always has an apiUrl by then.
    return;
  }
  saveConfig({ apiUrl: fallbackApiUrl, daemonFingerprint: fingerprint });
}

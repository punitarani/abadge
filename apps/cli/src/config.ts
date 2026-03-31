import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CliConfig {
  apiUrl: string;
  token: string;
}

const CONFIG_DIR = join(homedir(), ".abadge");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export function loadConfig(): CliConfig | null {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as CliConfig;
  } catch {
    return null;
  }
}

export function saveConfig(config: CliConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
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

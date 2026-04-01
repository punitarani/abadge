import { homedir } from "node:os";
import { join } from "node:path";

function abadgeDir(): string {
  return join(homedir(), ".abadge");
}

export function defaultSocketPath(): string {
  return join(abadgeDir(), "vaultd.sock");
}

export function defaultPidPath(): string {
  return join(abadgeDir(), "vaultd.pid");
}

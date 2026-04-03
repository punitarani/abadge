import { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type DaemonServer, resolveConfig, startServer } from "./server";
import type { DaemonConfig } from "./types";

function isProcessRunning(pid: number): boolean {
  try {
    // biome-ignore lint/style/noRestrictedGlobals: daemon requires process for PID management
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(pidPath: string): number | null {
  let content: string;
  try {
    content = readFileSync(pidPath, "utf-8").trim();
  } catch {
    return null;
  }
  const pid = Number.parseInt(content, 10);
  if (Number.isNaN(pid)) return null;
  return pid;
}

function writePid(pidPath: string): void {
  mkdirSync(dirname(pidPath), { recursive: true });
  // biome-ignore lint/style/noRestrictedGlobals: daemon requires process.pid
  writeFileSync(pidPath, String(process.pid), { mode: 0o600 });
}

function removePid(pidPath: string): void {
  try {
    unlinkSync(pidPath);
  } catch {
    // Already removed
  }
}

function hasSocket(socketPath: string): boolean {
  try {
    return statSync(socketPath).isSocket();
  } catch {
    return false;
  }
}

function removeSocket(socketPath: string): void {
  try {
    unlinkSync(socketPath);
  } catch {
    // Already removed
  }
}

export function clearDaemonState(partial: Partial<DaemonConfig> = {}): void {
  const config = resolveConfig(partial);
  removePid(config.pidPath);
  removeSocket(config.socketPath);
}

/**
 * Start the vaultd daemon.
 * Throws if another daemon is already running.
 */
export function startDaemon(partial: Partial<DaemonConfig> = {}): DaemonServer {
  const config = resolveConfig(partial);

  const existingPid = readPid(config.pidPath);
  if (existingPid !== null && isProcessRunning(existingPid) && hasSocket(config.socketPath)) {
    throw new Error(`Daemon already running with PID ${existingPid}`);
  }

  clearDaemonState(config);

  writePid(config.pidPath);

  let server: DaemonServer;
  try {
    server = startServer(config);
  } catch (error) {
    clearDaemonState(config);
    throw error;
  }

  const cleanup = (): void => {
    server.close();
    removePid(config.pidPath);
  };

  // biome-ignore lint/style/noRestrictedGlobals: daemon requires process for signal handling
  process.on("SIGTERM", () => {
    cleanup();
    // biome-ignore lint/style/noRestrictedGlobals: daemon requires process.exit
    process.exit(0);
  });

  // biome-ignore lint/style/noRestrictedGlobals: daemon requires process for signal handling
  process.on("SIGINT", () => {
    cleanup();
    // biome-ignore lint/style/noRestrictedGlobals: daemon requires process.exit
    process.exit(0);
  });

  // biome-ignore lint/style/noRestrictedGlobals: daemon requires process.pid
  console.log(`[vaultd] Listening on ${config.socketPath} (PID ${process.pid})`);

  return server;
}

/**
 * Stop a running daemon by PID file.
 * Returns true if the daemon was stopped, false if none was running.
 */
export function stopDaemon(partial: Partial<DaemonConfig> = {}): boolean {
  const config = resolveConfig(partial);
  const pid = readPid(config.pidPath);

  if (pid === null || !isProcessRunning(pid) || !hasSocket(config.socketPath)) {
    clearDaemonState(config);
    return false;
  }

  // biome-ignore lint/style/noRestrictedGlobals: daemon requires process.kill for lifecycle
  process.kill(pid, "SIGTERM");
  clearDaemonState(config);
  return true;
}

export function isDaemonRunning(partial: Partial<DaemonConfig> = {}): boolean {
  const config = resolveConfig(partial);
  const pid = readPid(config.pidPath);
  return pid !== null && isProcessRunning(pid) && hasSocket(config.socketPath);
}

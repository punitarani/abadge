import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { Command } from "commander";
import { requireConfig } from "../config";
import {
  clearDaemonProcessState,
  daemonAuthStatus,
  daemonProcessRunning,
  daemonStatus,
  serveDaemon,
  stopDaemonProcess,
} from "../daemon";
import { error, errorMessage, success } from "../output";

const READY_POLL_INTERVAL_MS = 100;
const READY_MAX_ATTEMPTS = 30;

function isPidRunning(pid: number | undefined): boolean {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForDaemonReady(
  childPid: number | undefined,
): Promise<"ready" | "exited" | "timeout"> {
  for (let attempt = 0; attempt < READY_MAX_ATTEMPTS; attempt += 1) {
    if (daemonProcessRunning()) {
      try {
        await daemonStatus();
        return "ready";
      } catch {
        // Socket exists but the daemon is not fully responding yet.
      }
    }

    if (!isPidRunning(childPid) && !daemonProcessRunning()) {
      return "exited";
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, READY_POLL_INTERVAL_MS));
  }

  return "timeout";
}

function resolveCurrentCliCommand(): { command: string; args: string[] } {
  const entrypoint = process.argv[1];
  if (entrypoint?.endsWith(".ts")) {
    return {
      command: process.execPath,
      args: [resolve(entrypoint), "daemon", "serve"],
    };
  }

  return {
    command: process.execPath,
    args: ["daemon", "serve"],
  };
}

export async function ensureDaemonStarted(): Promise<void> {
  requireConfig();

  if (daemonProcessRunning()) {
    try {
      await daemonStatus();
      return;
    } catch {
      clearDaemonProcessState();
    }
  }

  const current = resolveCurrentCliCommand();
  const child = spawn(current.command, current.args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  const readyState = await waitForDaemonReady(child.pid);
  if (readyState === "ready") {
    return;
  }

  if (readyState === "exited") {
    clearDaemonProcessState();
    throw new Error("Daemon exited before it became ready. Check `abadge daemon status`.");
  }

  if (child.pid) {
    try {
      process.kill(child.pid, "SIGTERM");
    } catch {
      // Child may already be gone.
    }
  }

  clearDaemonProcessState();
  throw new Error("Daemon failed to become ready in time.");
}

async function daemonStart(): Promise<void> {
  const wasRunning = daemonProcessRunning();

  try {
    await ensureDaemonStarted();
    success(wasRunning ? "Daemon is already running." : "Daemon started.");
  } catch (err) {
    error(errorMessage(err, "Failed to start daemon."));
    process.exit(1);
  }
}

async function daemonStop(): Promise<void> {
  if (!stopDaemonProcess()) {
    success("Daemon is already stopped.");
    return;
  }

  success("Daemon stopped.");
}

async function daemonStatusCmd(): Promise<void> {
  if (!daemonProcessRunning()) {
    error("Daemon is not running.");
    process.exit(1);
  }

  try {
    const status = await daemonStatus();
    const auth = await daemonAuthStatus().catch(() => null);
    console.log("Daemon: running");
    console.log(`  locked: ${String(status.locked)}`);
    console.log(`  keyVersion: ${String(status.keyVersion)}`);
    console.log(`  authenticated: ${String(auth?.authenticated ?? false)}`);
    if (auth?.authenticated) {
      console.log(`  authType: ${auth.type}`);
      console.log(`  authExpiresAt: ${auth.expiresAt}`);
    }
  } catch (err) {
    error(errorMessage(err, "Daemon is running but not responding correctly."));
    process.exit(1);
  }
}

async function daemonServe(): Promise<void> {
  await serveDaemon();
}

export function createDaemonCommand(): Command {
  const cmd = new Command("daemon").description(
    "Manage the local vault daemon that holds your session and unlocked profile keys in memory",
  );

  cmd
    .command("start")
    .description("Start the local daemon (auto-locks after 15 minutes of inactivity)")
    .action(daemonStart);
  cmd
    .command("stop")
    .description("Stop the daemon and clear all in-memory keys and session state")
    .action(daemonStop);
  cmd
    .command("status")
    .description("Show whether the daemon is running, locked, and authenticated")
    .action(daemonStatusCmd);
  cmd.addCommand(createDaemonServeCommand(), { hidden: true });

  return cmd;
}

export function createDaemonServeCommand(): Command {
  return new Command("serve").description("Run the daemon process").action(async () => {
    await daemonServe();
  });
}

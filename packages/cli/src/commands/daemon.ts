import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { Command } from "commander";
import { requireSessionConfig } from "../config";
import {
  clearDaemonProcessState,
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

export function resolveCurrentCliCommand(
  entrypoint: string | undefined = process.argv[1],
  execPath: string = process.execPath,
): { command: string; args: string[] } {
  if (entrypoint?.endsWith(".ts")) {
    return {
      command: execPath,
      args: [resolve(entrypoint), "daemon", "serve"],
    };
  }

  return {
    command: execPath,
    args: [entrypoint ?? execPath, "daemon", "serve"],
  };
}

async function daemonStart(): Promise<void> {
  requireSessionConfig();

  if (daemonProcessRunning()) {
    try {
      await daemonStatus();
      success("Daemon is already running.");
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
    success(`Daemon started (pid ${child.pid ?? "unknown"}).`);
    return;
  }

  if (readyState === "exited") {
    clearDaemonProcessState();
    error("Daemon exited before it became ready. Check `abadge daemon status`.");
    process.exit(1);
  }

  if (child.pid) {
    try {
      process.kill(child.pid, "SIGTERM");
    } catch {
      // Child may already be gone.
    }
  }

  clearDaemonProcessState();
  error("Daemon failed to become ready in time.");
  process.exit(1);
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
    console.log("Daemon: running");
    console.log(`  locked: ${String(status.locked)}`);
    console.log(`  keyVersion: ${String(status.keyVersion)}`);
  } catch (err) {
    error(errorMessage(err, "Daemon is running but not responding correctly."));
    process.exit(1);
  }
}

async function daemonServe(): Promise<void> {
  serveDaemon();
}

export function createDaemonCommand(): Command {
  const cmd = new Command("daemon").description("Manage local daemon");

  cmd.command("start").description("Start the daemon").action(daemonStart);
  cmd.command("stop").description("Stop the daemon").action(daemonStop);
  cmd.command("status").description("Show daemon status").action(daemonStatusCmd);
  cmd.addCommand(createDaemonServeCommand(), { hidden: true });

  return cmd;
}

export function createDaemonServeCommand(): Command {
  return new Command("serve").description("Run the daemon process").action(async () => {
    await daemonServe();
  });
}

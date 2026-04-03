import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { startDaemon, stopDaemon } from "@abadge/daemon";
import { Command } from "commander";
import { requireConfig } from "../config";
import { daemonStatus, SOCKET_PATH } from "../daemon";
import { error, success } from "../output";

export function createDaemonCommand(): Command {
  const cmd = new Command("daemon").description("Manage local daemon");

  cmd.command("start").description("Start the daemon").action(daemonStart);

  cmd.command("stop").description("Stop the daemon").action(daemonStop);

  cmd.command("status").description("Show daemon status").action(daemonStatusCmd);

  return cmd;
}

export function createDaemonServeCommand(): Command {
  return new Command("__daemon-serve")
    .requiredOption("--api-url <url>", "API URL")
    .requiredOption("--token <token>", "Auth token")
    .action(async (opts: { apiUrl: string; token: string }) => {
      startDaemon({ apiUrl: opts.apiUrl, authToken: opts.token });
      await new Promise(() => {});
    });
}

async function daemonStart(): Promise<void> {
  if (existsSync(SOCKET_PATH)) {
    try {
      const res = await daemonStatus();
      if (res.ok) {
        success("Daemon is already running.");
        return;
      }
    } catch {
      // Socket exists but daemon is dead — proceed to start
    }
  }

  const config = requireConfig();
  const command = resolveDaemonCommand();
  const child = spawn(
    command.executable,
    [...command.args, "--api-url", config.apiUrl, "--token", config.token],
    {
      detached: true,
      stdio: "ignore",
    },
  );
  child.unref();

  const ready = await waitForDaemonReady();
  if (!ready) {
    if (child.pid) {
      try {
        process.kill(child.pid, "SIGTERM");
      } catch {
        // Child may already have exited.
      }
    }
    error("Daemon failed to become ready.");
    process.exit(1);
  }

  success(`Daemon started (pid ${child.pid}).`);
}

async function daemonStop(): Promise<void> {
  const stopped = stopDaemon();
  if (!stopped) {
    error("Daemon is not running.");
    process.exit(1);
  }

  success("Daemon stopped.");
}

async function daemonStatusCmd(): Promise<void> {
  try {
    const res = await daemonStatus();
    if (res.ok) {
      console.log("Daemon: running");
      const data = res.data as Record<string, unknown> | undefined;
      if (data) {
        for (const [k, v] of Object.entries(data)) {
          console.log(`  ${k}: ${String(v)}`);
        }
      }
    } else {
      error(`Daemon error: ${res.error ?? "unknown"}`);
    }
  } catch {
    error("Daemon is not running.");
    process.exit(1);
  }
}

interface DaemonCommandTarget {
  executable: string;
  args: string[];
}

function resolveDaemonCommand(): DaemonCommandTarget {
  const entrypoint = process.argv[1];
  if (entrypoint && (entrypoint.endsWith(".ts") || entrypoint.endsWith(".js"))) {
    return {
      executable: process.execPath,
      args: [entrypoint, "__daemon-serve"],
    };
  }

  return {
    executable: process.execPath,
    args: ["__daemon-serve"],
  };
}

async function waitForDaemonReady(): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const status = await daemonStatus();
      if (status.ok) {
        return true;
      }
    } catch {
      // Daemon not ready yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return false;
}

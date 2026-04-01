import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { daemonLock, daemonStatus, SOCKET_PATH } from "../daemon";
import { error, success } from "../output";

export async function daemonCommand(args: string[]): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "start":
      return daemonStart();
    case "stop":
      return daemonStop();
    case "status":
      return daemonStatusCmd();
    default:
      console.log("Usage: abadge daemon <start|stop|status>");
      process.exit(sub ? 1 : 0);
  }
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

  const child = spawn("abadge-daemon", [], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  success(`Daemon started (pid ${child.pid}).`);
}

async function daemonStop(): Promise<void> {
  try {
    await daemonLock();
  } catch {
    // Daemon may already be stopped
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

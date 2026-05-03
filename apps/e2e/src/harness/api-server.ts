import { rmSync } from "node:fs";
import { join } from "node:path";
import type { Subprocess } from "bun";
import {
  allocatePort,
  E2E_BETTER_AUTH_SECRET,
  E2E_ENCRYPTION_KEY,
  mkTmpDir,
  TEST_DATABASE_URL,
} from "./env";

export interface ApiServerHandle {
  url: string;
  port: number;
  /** Stop the wrangler subprocess and clean up its state directory. */
  stop(): Promise<void>;
}

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const API_DIR = join(REPO_ROOT, "apps", "api");
const READY_TIMEOUT_MS = 60_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

/**
 * Start the abadge API worker via `wrangler dev --local`, wired to the
 * test Postgres and an isolated `.wrangler` persist dir (so the rate-limit
 * Durable Object resets between runs).
 *
 * `--var` overrides `apps/api/.dev.vars`, so a developer's local Doppler
 * setup never bleeds into the e2e suite.
 */
export async function startApiServer(): Promise<ApiServerHandle> {
  const port = await allocatePort();
  const url = `http://127.0.0.1:${port}`;
  const persistDir = mkTmpDir(`wrangler-${port}`);

  const args = [
    "x",
    "wrangler",
    "dev",
    "--local",
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--persist-to",
    persistDir,
    "--show-interactive-dev-session=false",
    // info is the lowest level that includes the "Ready on http://..." banner
    // we wait for; warn suppresses it and the harness will time out.
    "--log-level",
    "info",
    "--var",
    `DATABASE_URL:${TEST_DATABASE_URL}`,
    "--var",
    `ABADGE_API_URL:${url}`,
    "--var",
    `ABADGE_APP_URL:${url}`,
    "--var",
    `ENCRYPTION_KEY:${E2E_ENCRYPTION_KEY}`,
    "--var",
    `BETTER_AUTH_SECRET:${E2E_BETTER_AUTH_SECRET}`,
    "--var",
    "GOOGLE_CLIENT_ID:test-google",
    "--var",
    "GOOGLE_CLIENT_SECRET:test-google-secret",
    "--var",
    "GITHUB_CLIENT_ID:test-github",
    "--var",
    "GITHUB_CLIENT_SECRET:test-github-secret",
  ];

  const proc = Bun.spawn(["bun", ...args], {
    cwd: API_DIR,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      // biome-ignore lint/style/noRestrictedGlobals: e2e harness inherits the user's PATH for `bun x wrangler`
      ...process.env,
      CI: "1",
      FORCE_COLOR: "0",
      // Override the Hyperdrive binding's localConnectionString so the
      // worker's getConnectionString() (which prefers env.HYPERDRIVE) hits
      // the test DB instead of the dev DB pinned in wrangler.jsonc.
      WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: TEST_DATABASE_URL,
    },
  });

  const ready = waitForReady(proc, url);

  try {
    await ready;
  } catch (err) {
    await stopProcess(proc);
    rmSync(persistDir, { recursive: true, force: true });
    throw err;
  }

  return {
    url,
    port,
    async stop() {
      await stopProcess(proc);
      rmSync(persistDir, { recursive: true, force: true });
    },
  };
}

async function waitForReady(
  proc: Subprocess<"ignore", "pipe", "pipe">,
  url: string,
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  // Drain stdout/stderr concurrently. Some wrangler builds put the ready
  // banner on stderr, others on stdout — watch both.
  const drains = [
    drain(proc.stdout, deadline, url, "stdout"),
    drain(proc.stderr, deadline, url, "stderr"),
  ];
  const exit = proc.exited.then(() => {
    throw new Error("wrangler exited before becoming ready");
  });

  await Promise.race([Promise.any(drains), exit, timeout(deadline)]);

  // Belt-and-suspenders: even after the banner, the listener can race the
  // first request. Poll /health until it returns 200 or the deadline passes.
  // Bail early if wrangler exited (banner-then-crash gives a clear failure
  // instead of a 60s timeout of connection-refused fetches).
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`wrangler exited (code ${proc.exitCode}) after the ready banner`);
    }
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch {
      /* not yet */
    }
    await sleep(100);
  }
  throw new Error("wrangler dev came up but /health never responded 200");
}

async function drain(
  stream: ReadableStream<Uint8Array>,
  deadline: number,
  url: string,
  label: string,
): Promise<void> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buf = "";
  try {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += decoder.decode(value);
      // biome-ignore lint/style/noRestrictedGlobals: opt-in e2e debug log channel
      if (process.env.E2E_DEBUG) {
        // biome-ignore lint/style/noRestrictedGlobals: opt-in e2e debug log channel
        process.stderr.write(`[wrangler:${label}] ${decoder.decode(value)}`);
      }
      if (buf.includes(`Ready on ${url}`) || /\bReady on http:/.test(buf)) {
        return;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released or stream cancelled */
    }
  }
}

async function stopProcess(proc: Subprocess): Promise<void> {
  if (proc.exitCode !== null) return;
  proc.kill("SIGTERM");
  await Promise.race([proc.exited, sleep(SHUTDOWN_TIMEOUT_MS)]);
  if (proc.exitCode === null) {
    proc.kill("SIGKILL");
    await proc.exited;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timeout(deadline: number): Promise<void> {
  return new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error(`wrangler dev did not become ready within ${READY_TIMEOUT_MS}ms`)),
      Math.max(0, deadline - Date.now()),
    ),
  );
}

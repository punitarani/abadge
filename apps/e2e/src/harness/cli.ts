import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface CliRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CliRunOptions {
  /** Per-test isolated $HOME so the binary writes ~/.abadge/config.json into a tmpdir. */
  home: string;
  /** apiUrl baked into ~/.abadge/config.json — the binary prefers this over ABADGE_API_URL. */
  apiUrl: string;
  /** orgId stamped into ~/.abadge/config.json so multi-org commands skip the prompt. */
  activeOrgId?: string;
  /** Bearer session token shipped via env (the CLI accepts ABADGE_SESSION_TOKEN). */
  sessionToken?: string;
  /** Extra env to layer on top. */
  env?: Record<string, string>;
  /** Optional stdin to pipe (some commands read --value from stdin). */
  stdin?: string;
  /** Hard cap so a hung CLI cannot wedge the test runner. */
  timeoutMs?: number;
}

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const CLI_ENTRY = join(REPO_ROOT, "packages", "cli", "bin", "abadge.ts");
const COMPILED_BINARY = join(REPO_ROOT, "packages", "cli", "dist", "abadge");

/**
 * Run the CLI for a single command. Prefers the compiled binary at
 * packages/cli/dist/abadge if present (CI builds it), and falls back to
 * `bun packages/cli/bin/abadge.ts` for local iteration.
 *
 * Always writes a fresh ~/.abadge/config.json into the per-test HOME so
 * config-file `apiUrl` (which overrides ABADGE_API_URL — see TESTING.md
 * Phase 4 notes) points at the e2e wrangler port.
 */
export async function runCli(args: string[], opts: CliRunOptions): Promise<CliRunResult> {
  const configDir = join(opts.home, ".abadge");
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const config: Record<string, unknown> = { apiUrl: opts.apiUrl };
  if (opts.activeOrgId) config.activeOrgId = opts.activeOrgId;
  writeFileSync(join(configDir, "config.json"), JSON.stringify(config, null, 2), { mode: 0o600 });

  const useCompiled = existsSync(COMPILED_BINARY);
  const cmd = useCompiled ? [COMPILED_BINARY, ...args] : ["bun", CLI_ENTRY, ...args];

  const env: Record<string, string> = {
    // biome-ignore lint/style/noRestrictedGlobals: e2e harness inherits PATH and tooling env for the spawned CLI
    ...stripUndefined(process.env),
    HOME: opts.home,
    ABADGE_API_URL: opts.apiUrl,
    ...opts.env,
  };
  if (opts.sessionToken) env.ABADGE_SESSION_TOKEN = opts.sessionToken;
  // Strip any inherited agent creds — they would alter the auth path.
  delete env.ABADGE_AGENT_ID;
  delete env.ABADGE_PRIVATE_KEY;
  delete env.ABADGE_PRIVATE_KEY_PATH;

  const proc = Bun.spawn(cmd, {
    cwd: REPO_ROOT,
    env,
    stdin: opts.stdin !== undefined ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  if (opts.stdin !== undefined && proc.stdin) {
    proc.stdin.write(opts.stdin);
    proc.stdin.end();
  }

  const timeout = opts.timeoutMs ?? 30_000;
  const timer = setTimeout(() => {
    if (proc.exitCode === null) proc.kill("SIGKILL");
  }, timeout);

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);

  return { stdout, stderr, exitCode };
}

function stripUndefined(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

import { join } from "node:path";
import type { Subprocess } from "bun";

export interface McpClientOptions {
  apiUrl: string;
  agentId: string;
  /** Inline Ed25519 JWK (string) — the MCP config accepts ABADGE_PRIVATE_KEY directly. */
  privateKey: string;
  env?: Record<string, string>;
}

export interface McpToolCallResponse {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

export interface McpClient {
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResponse>;
  close(): Promise<void>;
}

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const MCP_ENTRY = join(REPO_ROOT, "packages", "mcp", "src", "index.ts");
const MCP_PROTOCOL_VERSION = "2024-11-05";
const REQUEST_TIMEOUT_MS = 30_000;

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Spawn `bun packages/mcp/src/index.ts` as an MCP stdio server and drive it
 * over JSON-RPC 2.0. Performs the standard MCP initialize / initialized
 * handshake, then exposes a callTool() method that matches responses by id.
 */
export async function startMcpClient(opts: McpClientOptions): Promise<McpClient> {
  const env: Record<string, string> = {
    // biome-ignore lint/style/noRestrictedGlobals: e2e harness inherits PATH and tooling env for the spawned MCP server
    ...stripUndefined(process.env),
    ABADGE_API_URL: opts.apiUrl,
    ABADGE_AGENT_ID: opts.agentId,
    ABADGE_PRIVATE_KEY: opts.privateKey,
    ...opts.env,
  };

  const proc = Bun.spawn(["bun", MCP_ENTRY], {
    cwd: REPO_ROOT,
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const pending = new Map<number, (msg: JsonRpcResponse) => void>();
  let nextId = 1;
  let closed = false;

  const reader = readLines(proc.stdout, (line) => {
    let parsed: JsonRpcResponse;
    try {
      parsed = JSON.parse(line) as JsonRpcResponse;
    } catch {
      return;
    }
    if (typeof parsed.id !== "number") return;
    const resolver = pending.get(parsed.id);
    if (!resolver) return;
    pending.delete(parsed.id);
    resolver(parsed);
  });

  // Surface MCP server errors so test failures explain themselves.
  void readLines(proc.stderr, (line) => {
    if (line.trim()) console.error(`[mcp stderr] ${line}`);
  });

  function send(message: Record<string, unknown>): void {
    if (!proc.stdin) throw new Error("mcp stdin is not writable");
    proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  function request(method: string, params: unknown): Promise<JsonRpcResponse> {
    const id = nextId++;
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`mcp ${method} timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);

      pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });

      send({ jsonrpc: "2.0", id, method, params });
    });
  }

  // Standard MCP handshake: initialize → notifications/initialized.
  const init = await request("initialize", {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "abadge-e2e", version: "0.0.0" },
  });
  if (init.error) {
    await stop(proc);
    throw new Error(`MCP initialize failed: ${init.error.message}`);
  }
  send({ jsonrpc: "2.0", method: "notifications/initialized" });

  return {
    async callTool(name, args): Promise<McpToolCallResponse> {
      const resp = await request("tools/call", { name, arguments: args });
      if (resp.error) {
        throw new Error(`MCP tools/call(${name}) error: ${resp.error.message}`);
      }
      return resp.result as McpToolCallResponse;
    },
    async close() {
      if (closed) return;
      closed = true;
      pending.clear();
      await stop(proc);
      await reader;
    },
  };
}

async function readLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        if (buf.trim()) onLine(buf);
        return;
      }
      buf += decoder.decode(value, { stream: true });
      let idx = buf.indexOf("\n");
      while (idx !== -1) {
        const line = buf.slice(0, idx).replace(/\r$/, "");
        buf = buf.slice(idx + 1);
        if (line) onLine(line);
        idx = buf.indexOf("\n");
      }
    }
  } catch {
    /* stream closed mid-read — fine, the test is shutting down */
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}

async function stop(proc: Subprocess): Promise<void> {
  if (proc.exitCode !== null) return;
  try {
    const stdin = proc.stdin;
    if (stdin && typeof stdin === "object" && "end" in stdin) {
      stdin.end();
    }
  } catch {
    /* stdin closed */
  }
  proc.kill("SIGTERM");
  await Promise.race([proc.exited, new Promise((resolve) => setTimeout(resolve, 3_000))]);
  if (proc.exitCode === null) {
    proc.kill("SIGKILL");
    await proc.exited;
  }
}

function stripUndefined(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

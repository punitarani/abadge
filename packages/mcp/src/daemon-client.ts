import { createConnection, type Socket } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

const SOCKET_PATH = join(homedir(), ".abadge", "vaultd.sock");

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

let nextId = 1;

function sendRpc(socket: Socket, req: JsonRpcRequest): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString();
      try {
        const parsed = JSON.parse(buffer) as JsonRpcResponse;
        socket.off("data", onData);
        resolve(parsed);
      } catch {
        // Incomplete JSON, wait for more data
      }
    };
    socket.on("data", onData);
    socket.on("error", (err) => reject(err));
    socket.write(`${JSON.stringify(req)}\n`);
  });
}

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(SOCKET_PATH);
    socket.once("connect", () => resolve(socket));
    socket.once("error", (err) => reject(err));
  });
}

export async function daemonCall<T = unknown>(
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  const socket = await connect();
  try {
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: nextId++,
      method,
      params,
    };
    const res = await sendRpc(socket, req);
    if (res.error) {
      throw new Error(`Daemon error ${res.error.code}: ${res.error.message}`);
    }
    return res.result as T;
  } finally {
    socket.destroy();
  }
}

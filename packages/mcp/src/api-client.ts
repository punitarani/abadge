import type { McpConfig } from "./config.js";

export interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

async function request<T>(
  config: McpConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResponse<T>> {
  const url = `${config.apiUrl}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${config.authToken}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as T;
  return { ok: res.ok, status: res.status, data };
}

export function apiGet<T = unknown>(config: McpConfig, path: string): Promise<ApiResponse<T>> {
  return request<T>(config, "GET", path);
}

export function apiPost<T = unknown>(
  config: McpConfig,
  path: string,
  body: unknown,
): Promise<ApiResponse<T>> {
  return request<T>(config, "POST", path, body);
}

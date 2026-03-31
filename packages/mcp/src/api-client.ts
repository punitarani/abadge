import type { McpConfig } from "./config.js";

export interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

export async function apiGet<T = unknown>(
  config: McpConfig,
  path: string,
): Promise<ApiResponse<T>> {
  const url = `${config.apiUrl}${path}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
  });
  const data = (await res.json()) as T;
  return { ok: res.ok, status: res.status, data };
}

export async function apiPost<T = unknown>(
  config: McpConfig,
  path: string,
  body: unknown,
): Promise<ApiResponse<T>> {
  const url = `${config.apiUrl}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T;
  return { ok: res.ok, status: res.status, data };
}

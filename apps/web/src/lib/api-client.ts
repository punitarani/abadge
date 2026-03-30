import { clientEnv } from "@abadge/env/client";

const API_URL = clientEnv.NEXT_PUBLIC_API_URL;

type FetchOptions = {
  method?: string;
  body?: unknown;
  cookie?: string;
};

async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options.cookie) {
    headers.Cookie = options.cookie;
  }

  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: "include",
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((error as { error?: string }).error ?? `API error: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export { API_URL, apiFetch };

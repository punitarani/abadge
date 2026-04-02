import { clientEnv } from "@abadge/env/client";

const apiBaseUrl = clientEnv.ABADGE_API_URL;

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

  const res = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: "include",
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(extractApiError(data, `API error: ${res.status}`));
  }

  return res.json() as Promise<T>;
}

/** Format the first Zod issue into a human-readable string. */
function formatZodIssue(issues: unknown[]): string | undefined {
  if (issues.length === 0) return undefined;
  const issue = issues[0] as { message?: string; path?: string[] };
  const path = issue.path?.join(".") ?? "";
  const msg = issue.message ?? "Validation error";
  return path ? `${path}: ${msg}` : msg;
}

/** Find a Zod issues array in either `{ error: { issues } }` or `{ issues }` shapes. */
function findZodIssues(obj: Record<string, unknown>): unknown[] | undefined {
  if (obj.error && typeof obj.error === "object") {
    const err = obj.error as Record<string, unknown>;
    if (Array.isArray(err.issues)) return err.issues;
  }
  if (Array.isArray(obj.issues)) return obj.issues;
  return undefined;
}

/** Extract a displayable error string from an API error response body. */
export function extractApiError(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  const obj = data as Record<string, unknown>;
  const issues = findZodIssues(obj);
  if (issues) return formatZodIssue(issues) ?? fallback;
  if (typeof obj.error === "string") return obj.error;
  if (typeof obj.message === "string") return obj.message;
  return fallback;
}

export { apiBaseUrl, apiFetch };

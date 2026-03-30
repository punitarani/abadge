import type { CliConfig } from "./config";

export interface AccessResult {
  value: string;
}

/** Minimal API client — inline fetch wrapper so CLI has no dependency on @abadge/broker. */
export class ApiClient {
  private baseUrl: string;
  private token: string;

  constructor(config: CliConfig) {
    this.baseUrl = config.apiUrl.replace(/\/$/, "");
    this.token = config.token;
  }

  async get<T = unknown>(path: string): Promise<T> {
    return this.request("GET", path);
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request("POST", path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
    };

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let message = `API ${method} ${path} failed (${res.status})`;
      try {
        const parsed = JSON.parse(text) as { error?: string; message?: string };
        message = parsed.error ?? parsed.message ?? message;
      } catch {
        if (text) message = text;
      }
      throw new Error(message);
    }

    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }
}

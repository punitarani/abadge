import type { QueryClientConfig } from "@tanstack/react-query";
import { QueryClient } from "@tanstack/react-query";
import type { TRPCClientErrorLike } from "@trpc/client";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "./server/router";

export interface BrowserTrpcClientOptions {
  baseUrl: string;
  /** Optional callback to resolve the active organization ID for X-Abadge-Org-Id header. */
  getOrgId?: () => string | undefined;
}

export interface NodeTrpcClientOptions {
  baseUrl: string;
  token?: string;
  headers?: unknown;
}

export interface NormalizedTrpcError {
  message: string;
  httpStatus?: number;
  trpcCode?: string;
  code?: string;
  issues?: unknown;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

function tokenToHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function toHeaderRecord(headers?: unknown): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (
    typeof headers === "object" &&
    headers !== null &&
    "forEach" in headers &&
    typeof (headers as { forEach?: unknown }).forEach === "function"
  ) {
    const record: Record<string, string> = {};
    (
      headers as {
        forEach: (callback: (value: string, key: string) => void) => void;
      }
    ).forEach((value, key) => {
      record[key] = value;
    });
    return record;
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(
      headers.flatMap((entry) =>
        Array.isArray(entry) && entry.length === 2 ? [[entry[0], String(entry[1])]] : [],
      ),
    );
  }

  if (typeof headers === "object" && headers !== null) {
    return Object.fromEntries(
      Object.entries(headers as Record<string, unknown>).flatMap(([key, value]) =>
        value === undefined || value === null
          ? []
          : [[key, Array.isArray(value) ? value.map(String).join(", ") : String(value)]],
      ),
    );
  }

  return {};
}

export function createBrowserTrpcClient(options: BrowserTrpcClientOptions) {
  const url = `${normalizeBaseUrl(options.baseUrl)}/trpc`;

  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url,
        headers() {
          const orgId = options.getOrgId?.();
          return orgId ? { "X-Abadge-Org-Id": orgId } : {};
        },
        fetch: ((input: unknown, init?: unknown) =>
          fetch(input as never, {
            ...(init as RequestInit | undefined),
            credentials: "include",
          }) as Promise<unknown>) as never,
      }),
    ],
  });
}

export function createNodeTrpcClient(options: NodeTrpcClientOptions) {
  const url = `${normalizeBaseUrl(options.baseUrl)}/trpc`;

  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url,
        headers() {
          return {
            ...toHeaderRecord(options.headers),
            ...(options.token ? tokenToHeaders(options.token) : {}),
          };
        },
      }),
    ],
  });
}

export function createTrpcQueryClient(config?: QueryClientConfig): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
    ...config,
  });
}

export function normalizeTrpcError(error: unknown): NormalizedTrpcError {
  if (!error || typeof error !== "object") {
    return { message: "Unknown error" };
  }

  const trpcError = error as TRPCClientErrorLike<AppRouter>;
  const data = trpcError.data as Record<string, unknown> | undefined;
  return {
    message: trpcError.message || "Request failed",
    httpStatus: typeof data?.httpStatus === "number" ? data.httpStatus : undefined,
    trpcCode: typeof data?.code === "string" ? data.code : undefined,
    code: typeof data?.code === "string" ? data.code : undefined,
    issues: data?.issues,
  };
}

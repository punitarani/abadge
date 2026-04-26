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
  /** Organization ID sent as X-Abadge-Org-Id header for org-scoped requests. */
  orgId?: string;
}

/**
 * Mirrors `NormalizedTrpcError` in `@abadge/sdk` (`packages/sdk/src/trpc.ts`)
 * field-for-field, EXCEPT `issues` which is deliberately typed differently
 * between the two copies:
 *   - This copy (trpc workspace-private): `issues?: unknown` — server callers
 *     can forward the raw value without needing the SDK's ValidationIssue type.
 *   - SDK copy (published package): `issues?: ReadonlyArray<ValidationIssue>`
 *     with a shape guard at `normalizeTrpcError`, because the SDK surface
 *     must be usable by external consumers.
 * Any change to hint/meta/other fields must be mirrored in both files.
 */
export interface NormalizedTrpcError {
  message: string;
  httpStatus?: number;
  trpcCode?: string;
  code?: string;
  hint?: string;
  meta?: Readonly<Record<string, unknown>>;
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
            ...(options.orgId ? { "X-Abadge-Org-Id": options.orgId } : {}),
          };
        },
      }),
    ],
  });
}

/** SPA cache profile for the dashboard — see comment block on the QueryClient defaults below. */
const ONE_MINUTE_MS = 60 * 1000;
const TEN_MINUTES_MS = 10 * 60 * 1000;

export function createTrpcQueryClient(config?: QueryClientConfig): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // SPA cache profile for the dashboard:
        //   - 1-minute staleTime: cached data is reused across intra-dashboard
        //     navigation without refetch, but a mount of a >60s-old query still
        //     refetches (refetchOnMount default true) — that's intentional, the
        //     dashboard surfaces security-sensitive state (permissions, agents)
        //     that must not silently lag behind reality.
        //   - 10-minute gcTime: cache survives long enough for back-navigation
        //     to feel instant after a brief detour.
        //   - refetchOnWindowFocus disabled: this is an admin tool, not a stock
        //     ticker; tab-switching shouldn't trigger a refetch storm.
        //   - refetchOnReconnect "always": after network recovery, force fresh
        //     data even if technically still within staleTime.
        staleTime: ONE_MINUTE_MS,
        gcTime: TEN_MINUTES_MS,
        refetchOnWindowFocus: false,
        refetchOnReconnect: "always",
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
    hint: typeof data?.hint === "string" ? data.hint : undefined,
    meta:
      data?.meta && typeof data.meta === "object" && !Array.isArray(data.meta)
        ? (data.meta as Record<string, unknown>)
        : undefined,
    issues: data?.issues,
  };
}

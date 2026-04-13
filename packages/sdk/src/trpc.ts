import type { TRPCClientErrorLike } from "@trpc/client";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AnyTRPCRouter } from "@trpc/server";

interface NodeTrpcClientOptions {
  baseUrl: string;
  token?: string;
  headers?: unknown;
  /** Organization ID sent as X-Abadge-Org-Id header for org-scoped requests. */
  orgId?: string;
}

interface NormalizedTrpcError {
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

export function createNodeTrpcClient(options: NodeTrpcClientOptions) {
  const url = `${normalizeBaseUrl(options.baseUrl)}/trpc`;

  // The public SDK cannot depend on the private workspace router package.
  // Keep the SDK boundary typed locally and use an untyped proxy internally.
  return createTRPCClient<AnyTRPCRouter>({
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

export function normalizeTrpcError(error: unknown): NormalizedTrpcError {
  if (!error || typeof error !== "object") {
    return { message: "Unknown error" };
  }

  const trpcError = error as TRPCClientErrorLike<AnyTRPCRouter>;
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

import { OPERATOR_TOKEN_PREFIX } from "@abadge/core";
import type { TRPCClientErrorLike } from "@trpc/client";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AnyTRPCRouter } from "@trpc/server";

interface NodeTrpcClientOptions {
  baseUrl: string;
  token?: string;
  headers?: unknown;
}

interface NormalizedTrpcError {
  message: string;
  httpStatus?: number;
  trpcCode?: string;
  appCode?: string;
  issues?: unknown;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
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
            ...(options.token?.startsWith(OPERATOR_TOKEN_PREFIX)
              ? { "X-Abadge-Operator-Token": options.token }
              : options.token
                ? { Authorization: `Bearer ${options.token}` }
                : {}),
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
    appCode: typeof data?.appCode === "string" ? data.appCode : undefined,
    issues: data?.issues,
  };
}

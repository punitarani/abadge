import type { createServerCaller } from "@abadge/trpc/server";
import { createServerCallerContext } from "@abadge/trpc/server";
import { TRPCError } from "@trpc/server";
import type { Context } from "hono";
import type { Bindings } from "../types.js";

type ApiContext = Context<{ Bindings: Bindings }>;

type ApiErrorBody = {
  error: string;
  code?: string;
  issues?: unknown;
};

function trpcCodeToStatus(code: string): number {
  switch (code) {
    case "BAD_REQUEST":
    case "PARSE_ERROR":
      return 400;
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    case "TOO_MANY_REQUESTS":
      return 429;
    default:
      return 500;
  }
}

export function toApiError(error: unknown): { status: number; body: ApiErrorBody } {
  if (error instanceof TRPCError) {
    const statusSource = error.cause as unknown as { statusCode?: unknown } | undefined;
    const status =
      typeof statusSource?.statusCode === "number"
        ? statusSource.statusCode
        : trpcCodeToStatus(error.code);
    const cause = error.cause as unknown as { code?: unknown; issues?: unknown } | undefined;

    return {
      status,
      body: {
        error: error.message || "Request failed",
        ...(typeof cause?.code === "string" ? { code: cause.code } : {}),
        ...(cause?.issues ? { issues: cause.issues } : {}),
      },
    };
  }

  if (error instanceof Error) {
    return {
      status: 500,
      body: { error: error.message || "Internal server error" },
    };
  }

  return {
    status: 500,
    body: { error: "Internal server error" },
  };
}

function mergeResponseHeaders(response: Response, headers: Headers): Response {
  for (const [name, value] of headers.entries()) {
    if (name.toLowerCase() === "set-cookie") {
      response.headers.append(name, value);
      continue;
    }

    response.headers.set(name, value);
  }

  return response;
}

export async function withCallerResult(
  c: ApiContext,
  handler: (caller: ReturnType<typeof createServerCaller>) => Promise<Response>,
): Promise<Response> {
  const { caller, resHeaders } = createServerCallerContext(c.req.raw, c.env);

  try {
    return mergeResponseHeaders(await handler(caller), resHeaders);
  } catch (error) {
    const { status, body } = toApiError(error);
    return mergeResponseHeaders(
      c.json(body, status as 400 | 401 | 403 | 404 | 409 | 429 | 500),
      resHeaders,
    );
  }
}

export async function readJsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid JSON body" });
  }
}

export function readOptionalInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

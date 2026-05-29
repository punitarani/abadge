import { formatDomainError, getDomainErrorStatus, isDomainError } from "@abadge/core";
import { appRouter, createServerCaller, type RestMeta } from "@abadge/trpc/server";
import { TRPCError } from "@trpc/server";
import type { Context } from "hono";
import type { Bindings } from "../types";

/**
 * Canonical REST surface at `/v1/...`. Every route here delegates to a
 * tRPC procedure via `appRouter.createCaller`, so authorization, validation,
 * audit, and decryption stay in exactly one place (the tRPC layer).
 *
 * The routing table is derived from each procedure's `.meta({ openapi })`
 * annotation. There's no second source of truth: changes in
 * `packages/trpc/src/server/routers/*` propagate here on the next build.
 *
 * We picked a hand-written adapter over `trpc-to-openapi` because that
 * package's 3.x line peer-depends on zod ^4 and this codebase uses Effect
 * Schema. See the commit "feat(trpc): annotate procedures with openapi
 * metadata for REST derivation" for the full reasoning.
 */

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface CompiledRoute {
  procedurePath: string;
  method: Method;
  /** Original template, e.g. `/orgs/{orgId}/profiles`. */
  template: string;
  paramNames: string[];
  /** Regex compiled against the URL path after the `/v1` prefix. */
  pattern: RegExp;
  /** "query" or "mutation". */
  trpcType: "query" | "mutation";
  tags: string[];
  protect: boolean;
  summary?: string;
}

function compileRoutes(): CompiledRoute[] {
  const routes: CompiledRoute[] = [];
  const procedures = (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })
    ._def.procedures;

  for (const [procedurePath, proc] of Object.entries(procedures)) {
    const procRec = proc as { _def?: { meta?: RestMeta; type?: "query" | "mutation" } };
    const meta = procRec._def?.meta;
    const trpcType = procRec._def?.type;
    if (!meta?.openapi || !trpcType) continue;

    const paramNames: string[] = [];
    const regexBody = meta.openapi.path.replace(/\{([^}]+)\}/g, (_match, name) => {
      paramNames.push(name);
      // Match any non-slash sequence; tRPC inputs validate further (NonEmptyString).
      return "([^/]+)";
    });

    routes.push({
      procedurePath,
      method: meta.openapi.method,
      template: meta.openapi.path,
      paramNames,
      pattern: new RegExp(`^${regexBody}$`),
      trpcType,
      tags: meta.openapi.tags,
      protect: meta.openapi.protect,
      summary: meta.openapi.summary,
    });
  }

  return routes;
}

// ROUTES is compiled lazily on first access rather than at module load. This
// is robust to Bun test runner ordering: `mock.module(...)` registrations
// in sibling test files only affect subsequent imports, so capturing the
// routing table at module-load made test correctness depend on which file's
// mock won the race to evaluate `./index` first. Lazy compilation defers the
// read of `appRouter._def.procedures` to the first request, by which point
// the test's mock has been applied and stays applied for the file's lifetime.
// Production cost: one route-table compile on cold start (~milliseconds).
let _routes: CompiledRoute[] | null = null;
function getRoutes(): CompiledRoute[] {
  if (_routes === null) _routes = compileRoutes();
  return _routes;
}

/** Map a tRPC error code or domain error to an HTTP status. */
export function statusFromError(err: unknown): number {
  if (isDomainError(err)) return getDomainErrorStatus(err);
  if (err instanceof TRPCError) {
    switch (err.code) {
      case "BAD_REQUEST":
        return 400;
      case "UNAUTHORIZED":
        return 401;
      case "FORBIDDEN":
        return 403;
      case "NOT_FOUND":
        return 404;
      case "CONFLICT":
        return 409;
      case "PAYLOAD_TOO_LARGE":
        return 413;
      case "UNPROCESSABLE_CONTENT":
        return 422;
      case "TOO_MANY_REQUESTS":
        return 429;
      default:
        return 500;
    }
  }
  return 500;
}

interface ErrorEnvelope {
  code: string;
  message: string;
  hint: string | null;
  meta: Record<string, unknown> | null;
}

export function errorEnvelope(err: unknown): ErrorEnvelope {
  // tRPC's TRPCError wraps the original cause; unwrap one level so domain
  // errors thrown inside procedures surface with their full envelope.
  const cause: unknown = err instanceof TRPCError ? (err.cause ?? err) : err;
  if (isDomainError(cause)) {
    const formatted = formatDomainError(cause);
    return {
      code: formatted.code,
      message: formatted.message,
      hint: formatted.hint ?? null,
      meta: (formatted.meta as Record<string, unknown> | undefined) ?? null,
    };
  }
  if (err instanceof TRPCError) {
    return {
      code: err.code,
      message: err.message,
      hint: null,
      meta: null,
    };
  }
  return {
    code: "INTERNAL_SERVER_ERROR",
    message: "Internal server error",
    hint: null,
    meta: null,
  };
}

async function readBody(c: Context<{ Bindings: Bindings }>): Promise<Record<string, unknown>> {
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.includes("application/json")) return {};
  try {
    const parsed = await c.req.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    // Reject array/scalar bodies — tRPC procedures all take object inputs.
    return {};
  } catch {
    return {};
  }
}

/**
 * Returns the matched route plus the extracted path-param map.
 *
 * `pathAfterPrefix` must be the URL path with the `/v1` prefix already
 * stripped, no trailing slash, and no query string.
 */
function matchRoute(
  method: string,
  pathAfterPrefix: string,
): { route: CompiledRoute; params: Record<string, string> } | null {
  const upper = method.toUpperCase() as Method;
  for (const route of getRoutes()) {
    if (route.method !== upper) continue;
    const m = route.pattern.exec(pathAfterPrefix);
    if (!m) continue;
    const params: Record<string, string> = {};
    for (let i = 0; i < route.paramNames.length; i++) {
      const name = route.paramNames[i];
      const value = m[i + 1];
      if (name === undefined || value === undefined) continue;
      params[name] = decodeURIComponent(value);
    }
    return { route, params };
  }
  return null;
}

/**
 * Resolve the caller method for a dotted procedure path. tRPC's caller
 * object mirrors the router record, so `agents.create` lives at
 * `caller.agents.create`.
 */
function resolveCallerMethod(
  caller: unknown,
  procedurePath: string,
): ((input: unknown) => Promise<unknown>) | null {
  const parts = procedurePath.split(".");
  let current: unknown = caller;
  for (const part of parts) {
    if (current === null || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "function" ? (current as (input: unknown) => Promise<unknown>) : null;
}

/** Coerce query-string values into the input object. */
function readQueryParams(url: URL): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of url.searchParams.entries()) {
    // Multi-value keys collapse to array; single keys stay scalar.
    if (k in out) {
      const existing = out[k];
      if (Array.isArray(existing)) existing.push(v);
      else out[k] = [existing, v];
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Hono handler for the `/v1/*` subtree. Returns 404 if no route matches.
 */
export async function handleV1Request(c: Context<{ Bindings: Bindings }>): Promise<Response> {
  const url = new URL(c.req.url);
  const pathAfterPrefix = url.pathname.replace(/^\/v1/, "") || "/";

  // Built-in /v1/health — always 200; doesn't need a tRPC trip.
  if (pathAfterPrefix === "/health" && c.req.method.toUpperCase() === "GET") {
    return c.json({ status: "ok" });
  }

  const matched = matchRoute(c.req.method, pathAfterPrefix);
  if (!matched) {
    return c.json(
      {
        code: "NOT_FOUND",
        message: "Route not found",
        hint: "Inspect /v1/openapi.json for the canonical route table.",
        meta: { path: c.req.path, method: c.req.method },
      },
      404,
    );
  }

  // GET routes pull inputs from the query string; mutations from JSON body.
  const sourceFields =
    matched.route.trpcType === "query" ? readQueryParams(url) : await readBody(c);
  // Path params override request-provided fields so a caller can't bypass
  // path-bound IDs by stuffing alternate values into the body or query.
  const input: Record<string, unknown> = { ...sourceFields, ...matched.params };

  try {
    const caller = createServerCaller(c.req.raw, c.env);
    const method = resolveCallerMethod(caller, matched.route.procedurePath);
    if (!method) {
      return c.json(
        {
          code: "INTERNAL_SERVER_ERROR",
          message: `Could not resolve procedure: ${matched.route.procedurePath}`,
          hint: null,
          meta: null,
        },
        500,
      );
    }

    // Procedures with no .input() schema accept `undefined`; pass the merged
    // object only when we actually have keys to send.
    const result = await method(Object.keys(input).length > 0 ? input : undefined);
    return c.json(result as Record<string, unknown> | unknown[] | null);
  } catch (err) {
    const status = statusFromError(err);
    if (status >= 500) {
      // Log unexpected errors for observability; the wire envelope stays terse.
      console.error("[/v1] handler error", err);
    }
    const envelope = errorEnvelope(err);
    return c.json(envelope, status as 400);
  }
}

/** Exposed for tests + the OpenAPI doc generator. */
export function getCompiledRoutes(): ReadonlyArray<CompiledRoute> {
  return getRoutes();
}

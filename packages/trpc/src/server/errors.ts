import type { DomainError } from "@abadge/core";
import {
  formatDomainError,
  getDomainErrorStatus,
  isDomainError,
  parseErrorToValidationError,
  ServiceUnavailableError,
  type ValidationIssueSchema,
} from "@abadge/core";
import { type TRPC_ERROR_CODE_KEY, TRPCError } from "@trpc/server";
import { Cause, type Cause as EffectCause, Option, ParseResult, type Schema } from "effect";

export interface TrpcErrorData {
  code?: string;
  hint?: string;
  meta?: Readonly<Record<string, unknown>>;
  issues?: ReadonlyArray<Schema.Schema.Type<typeof ValidationIssueSchema>>;
}

export function mapStatusToTrpcCode(status: number): TRPC_ERROR_CODE_KEY {
  switch (status) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 429:
      return "TOO_MANY_REQUESTS";
    case 503:
      return "SERVICE_UNAVAILABLE";
    default:
      return "INTERNAL_SERVER_ERROR";
  }
}

// Postgres SQLSTATEs and driver/socket error codes that signal a transient
// capacity or connectivity failure — the request did nothing wrong; the
// database is at its connection limit or briefly unreachable. These map to a
// retryable 503 instead of an opaque 500. SQLSTATE class `08` (connection
// exceptions) is matched by prefix; the rest are enumerated.
const RETRYABLE_DB_ERROR_CODES: ReadonlySet<string> = new Set([
  "53300", // too_many_connections
  "53400", // configuration_limit_exceeded
  "57014", // query_canceled — statement_timeout fired (slot was held too long)
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
  // postgres-js / node socket-level connection failures
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
]);

// Resolve a driver error code from the error itself OR its `.cause`. Drizzle
// v0.45+ wraps the original postgres-js error (which carries the SQLSTATE /
// socket code) in a `DrizzleQueryError` whose `.cause` is the driver error and
// which has NO top-level `code` — so checking the error alone misses every real
// query-path failure. Mirrors the `isUniqueViolation` precedent in effect.ts.
function resolveDbErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const code =
    (error as { code?: unknown }).code ?? (error as { cause?: { code?: unknown } }).cause?.code;
  return typeof code === "string" ? code : undefined;
}

function isRetryableDbError(error: unknown): boolean {
  const code = resolveDbErrorCode(error);
  if (code === undefined) {
    return false;
  }
  // SQLSTATE class 08 = connection_exception (08000, 08003, 08006, ...).
  return code.startsWith("08") || RETRYABLE_DB_ERROR_CODES.has(code);
}

const fiberFailureCauseSymbol = Symbol.for("effect/Runtime/FiberFailure/Cause");

function unwrapEffectError(error: unknown): unknown {
  if (!error || typeof error !== "object") {
    return error;
  }

  const candidate = error as Record<PropertyKey, unknown>;
  const cause = candidate[fiberFailureCauseSymbol] as EffectCause.Cause<unknown> | undefined;
  if (!cause) {
    return error;
  }

  const failure = Cause.failureOption(cause);
  if (Option.isSome(failure)) {
    return failure.value;
  }

  return Cause.squash(cause);
}

export function toTrpcError(error: unknown): TRPCError {
  const cause = unwrapEffectError(error);

  if (cause instanceof TRPCError) {
    return cause;
  }

  if (isDomainError(cause)) {
    return new TRPCError({
      code: mapStatusToTrpcCode(getDomainErrorStatus(cause)),
      message: cause.message,
      cause,
    });
  }

  // Effect Schema ParseError — convert to structured ValidationError so clients
  // receive a proper issues[] array instead of a generic INTERNAL_SERVER_ERROR.
  // Must be checked before the `instanceof Error` branch because ParseError extends Error.
  if (ParseResult.isParseError(cause)) {
    const validation = parseErrorToValidationError(cause);
    return new TRPCError({
      code: mapStatusToTrpcCode(getDomainErrorStatus(validation)),
      message: validation.message,
      cause: validation,
    });
  }

  // Transient database capacity/connectivity failures become a retryable 503
  // (with a Retry-After hint) rather than an opaque 500, so clients back off
  // and the connection pool drains. Routed through a ServiceUnavailableError so
  // it carries the standard {code,message,hint,meta} envelope. The raw driver
  // message is intentionally dropped from the wire (it can carry SQL/constraint
  // names); capacity blips are an expected operational outcome, not a 500-class
  // bug worth Sentry noise.
  if (isRetryableDbError(cause)) {
    // Log the SQLSTATE/socket code (NOT the message — no SQL/constraint leak) so
    // a *recurring* fault (a persistent connection leak, or a pathological query
    // tripping statement_timeout → 57014) stays visible in worker logs instead
    // of looking identical to a one-off blip. This 503 path is otherwise
    // unlogged: the tRPC fetch handler sets no onError and the /v1 logger only
    // fires for status >= 500.
    console.warn(`db_transient_failure code=${resolveDbErrorCode(cause) ?? "unknown"} -> 503`);
    const serviceUnavailable = new ServiceUnavailableError({
      code: "SERVICE_UNAVAILABLE",
      message: "Service temporarily unavailable.",
      hint: "The database is at capacity or briefly unreachable. Retry after a short backoff.",
      meta: { retryAfterSeconds: 2 },
    });
    return new TRPCError({
      code: mapStatusToTrpcCode(getDomainErrorStatus(serviceUnavailable)),
      message: serviceUnavailable.message,
      cause: serviceUnavailable,
    });
  }

  if (cause instanceof Error) {
    // Use a generic message to prevent DB constraint names, SQL snippets, and
    // other internal details from leaking to the wire. The original cause is
    // preserved for server-side logging and Sentry; it is not serialised into
    // the response body after the errorFormatter strips shape.data.
    return new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal server error",
      cause,
    });
  }

  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Unknown error",
  });
}

export function getTrpcErrorData(error: TRPCError): TrpcErrorData {
  const cause = unwrapEffectError(error.cause);
  if (!isDomainError(cause)) {
    return {};
  }

  const formatted = formatDomainError(cause);
  return {
    code: formatted.code,
    ...(formatted.hint ? { hint: formatted.hint } : {}),
    ...(formatted.meta ? { meta: formatted.meta } : {}),
    ...(formatted.issues ? { issues: formatted.issues } : {}),
  };
}

export function isDomainErrorCause(error: unknown): error is DomainError {
  return isDomainError(error);
}

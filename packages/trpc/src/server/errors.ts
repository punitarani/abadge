import type { DomainError } from "@abadge/core";
import {
  formatDomainError,
  getDomainErrorStatus,
  isDomainError,
  parseErrorToValidationError,
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
    default:
      return "INTERNAL_SERVER_ERROR";
  }
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

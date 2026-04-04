import { ParseResult, Schema } from "effect";
import type { ErrorCode } from "./constants";

const ErrorCodeSchema = Schema.Literal(
  "BAD_REQUEST",
  "NOT_FOUND",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "CONFLICT",
  "RATE_LIMITED",
  "VAULT_NOT_FOUND",
  "VAULT_ALREADY_EXISTS",
  "ITEM_NOT_FOUND",
  "AGENT_NOT_FOUND",
  "AGENT_REVOKED",
  "AGENT_NOT_ENROLLED",
  "AGENT_ALREADY_ENROLLED",
  "AGENT_CHALLENGE_NOT_FOUND",
  "AGENT_CHALLENGE_EXPIRED",
  "AGENT_SESSION_NOT_FOUND",
  "INVALID_BOOTSTRAP_TOKEN",
  "BOOTSTRAP_TOKEN_EXPIRED",
  "PERMISSION_NOT_FOUND",
  "PERMISSION_DENIED",
  "PERMISSION_EXPIRED",
  "INVALID_CAPABILITY",
  "STALE_VERSION",
  "VALIDATION_ERROR",
);

export const ValidationIssueSchema = Schema.Struct({
  path: Schema.Array(Schema.Union(Schema.String, Schema.Number)),
  message: Schema.String,
});

export class BadRequestError extends Schema.TaggedError<BadRequestError>()("BadRequestError", {
  code: ErrorCodeSchema,
  message: Schema.String,
}) {
  readonly statusCode = 400;
}

export class ValidationError extends Schema.TaggedError<ValidationError>()("ValidationError", {
  code: Schema.Literal("VALIDATION_ERROR"),
  message: Schema.String,
  issues: Schema.Array(ValidationIssueSchema),
}) {
  readonly statusCode = 400;
}

export class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()(
  "UnauthorizedError",
  {
    code: ErrorCodeSchema,
    message: Schema.String,
  },
) {
  readonly statusCode = 401;
}

export class ForbiddenError extends Schema.TaggedError<ForbiddenError>()("ForbiddenError", {
  code: ErrorCodeSchema,
  message: Schema.String,
}) {
  readonly statusCode = 403;
}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("NotFoundError", {
  code: ErrorCodeSchema,
  message: Schema.String,
}) {
  readonly statusCode = 404;
}

export class ConflictError extends Schema.TaggedError<ConflictError>()("ConflictError", {
  code: ErrorCodeSchema,
  message: Schema.String,
}) {
  readonly statusCode = 409;
}

export class RateLimitError extends Schema.TaggedError<RateLimitError>()("RateLimitError", {
  code: Schema.Literal("RATE_LIMITED"),
  message: Schema.String,
}) {
  readonly statusCode = 429;
}

export type DomainError =
  | BadRequestError
  | ValidationError
  | UnauthorizedError
  | ForbiddenError
  | NotFoundError
  | ConflictError
  | RateLimitError;

export function isDomainError(error: unknown): error is DomainError {
  return (
    error instanceof BadRequestError ||
    error instanceof ValidationError ||
    error instanceof UnauthorizedError ||
    error instanceof ForbiddenError ||
    error instanceof NotFoundError ||
    error instanceof ConflictError ||
    error instanceof RateLimitError
  );
}

export function getDomainErrorStatus(error: DomainError): number {
  return error.statusCode;
}

export function getDomainErrorCode(error: DomainError): ErrorCode {
  return error.code as ErrorCode;
}

export function formatDomainError(error: DomainError): {
  code: ErrorCode;
  message: string;
  issues?: ReadonlyArray<Schema.Schema.Type<typeof ValidationIssueSchema>>;
} {
  if (error instanceof ValidationError) {
    return { code: error.code, message: error.message, issues: error.issues };
  }
  return { code: error.code as ErrorCode, message: error.message };
}

export function parseErrorToValidationError(error: ParseResult.ParseError): ValidationError {
  const issues = ParseResult.ArrayFormatter.formatErrorSync(error).map((issue) => ({
    path: issue.path.filter(
      (segment): segment is string | number =>
        typeof segment === "string" || typeof segment === "number",
    ),
    message: issue.message,
  }));

  return new ValidationError({
    code: "VALIDATION_ERROR",
    message: issues[0]?.message ?? "Validation error",
    issues,
  });
}

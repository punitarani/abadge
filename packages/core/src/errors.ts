import { ParseResult, Schema } from "effect";
import type { ErrorCode } from "./constants";

const NonEmptyString = Schema.String.pipe(Schema.minLength(1));
const DomainErrorMetaSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown });

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
  "ITEM_ALREADY_EXISTS",
  "AGENT_NOT_FOUND",
  "AGENT_REVOKED",
  "AGENT_NOT_ENROLLED",
  "AGENT_ALREADY_ENROLLED",
  "AGENT_CHALLENGE_NOT_FOUND",
  "AGENT_CHALLENGE_EXPIRED",
  "AGENT_SESSION_NOT_FOUND",
  "INVALID_BOOTSTRAP_TOKEN",
  "BOOTSTRAP_TOKEN_EXPIRED",
  "INVALID_CLAIM_TOKEN",
  "CLAIM_TOKEN_EXPIRED",
  "CLAIM_ALREADY_COMPLETED",
  "CLAIM_EMAIL_IN_USE",
  "OTP_NOT_REQUESTED",
  "OTP_INVALID",
  "OTP_EXPIRED",
  "OTP_ATTEMPTS_EXCEEDED",
  "PERMISSION_NOT_FOUND",
  "PERMISSION_ALREADY_EXISTS",
  "PERMISSION_DENIED",
  "PERMISSION_EXPIRED",
  "INVALID_CAPABILITY",
  "INVALID_CAPABILITY_LOCALITY",
  "INVALID_CAPABILITY_STORAGE",
  "PUBLIC_KEY_REQUIRED",
  "ENROLLMENT_REQUIRED",
  "STALE_VERSION",
  "FIELD_NOT_FOUND",
  "MULTI_FIELD_ITEM",
  "PROFILE_NOT_FOUND",
  "PROFILE_ALREADY_EXISTS",
  "PROFILE_NOT_EMPTY",
  "ROTATE_KEY_INCOMPLETE",
  "CONFIRMATION_MISMATCH",
  "REAUTH_FAILED",
  "REAUTH_PASSWORD_REQUIRED",
  "SLUG_TAKEN",
  "ITEM_DELETED",
  "MEMBER_INSUFFICIENT_ROLE",
  "MEMBER_AGENT_OWNERSHIP",
  "ORG_HEADER_REQUIRED",
  "NO_ORG_MEMBERSHIP",
  "ORG_MEMBERSHIP_REQUIRED",
  "INVITE_NOT_FOUND",
  "INVITE_EXPIRED",
  "INVITE_ALREADY_USED",
  "ALREADY_MEMBER",
  "VALIDATION_ERROR",
  "INTEGRITY_ERROR",
  "SESSION_REFRESH_FAILED",
  "MOUNT_NOT_FOUND",
);

export const ValidationIssueSchema = Schema.Struct({
  path: Schema.Array(Schema.Union(Schema.String, Schema.Number)),
  message: Schema.String,
});

export class BadRequestError extends Schema.TaggedError<BadRequestError>()("BadRequestError", {
  code: ErrorCodeSchema,
  message: Schema.String,
  hint: NonEmptyString,
  meta: Schema.optional(DomainErrorMetaSchema),
}) {
  readonly statusCode = 400;
}

export class ValidationError extends Schema.TaggedError<ValidationError>()("ValidationError", {
  code: Schema.Literal("VALIDATION_ERROR"),
  message: Schema.String,
  hint: NonEmptyString,
  meta: Schema.optional(DomainErrorMetaSchema),
  issues: Schema.Array(ValidationIssueSchema),
}) {
  readonly statusCode = 400;
}

export class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()(
  "UnauthorizedError",
  {
    code: ErrorCodeSchema,
    message: Schema.String,
    hint: NonEmptyString,
    meta: Schema.optional(DomainErrorMetaSchema),
  },
) {
  readonly statusCode = 401;
}

export class ForbiddenError extends Schema.TaggedError<ForbiddenError>()("ForbiddenError", {
  code: ErrorCodeSchema,
  message: Schema.String,
  hint: NonEmptyString,
  meta: Schema.optional(DomainErrorMetaSchema),
}) {
  readonly statusCode = 403;
}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("NotFoundError", {
  code: ErrorCodeSchema,
  message: Schema.String,
  hint: NonEmptyString,
  meta: Schema.optional(DomainErrorMetaSchema),
}) {
  readonly statusCode = 404;
}

export class ConflictError extends Schema.TaggedError<ConflictError>()("ConflictError", {
  code: ErrorCodeSchema,
  message: Schema.String,
  hint: NonEmptyString,
  meta: Schema.optional(DomainErrorMetaSchema),
}) {
  readonly statusCode = 409;
}

export class RateLimitError extends Schema.TaggedError<RateLimitError>()("RateLimitError", {
  code: Schema.Literal("RATE_LIMITED"),
  message: Schema.String,
  hint: NonEmptyString,
  meta: Schema.optional(DomainErrorMetaSchema),
}) {
  readonly statusCode = 429;
}

export class IntegrityError extends Schema.TaggedError<IntegrityError>()("IntegrityError", {
  code: Schema.Literal("INTEGRITY_ERROR"),
  message: Schema.String,
  hint: NonEmptyString,
  meta: Schema.optional(DomainErrorMetaSchema),
}) {
  readonly statusCode = 500;
}

function formatAvailableFields(availableFields: readonly string[]): string {
  return availableFields.length > 0
    ? `Available fields: ${availableFields.join(", ")}.`
    : "This item does not expose any string fields.";
}

export class FieldNotFoundError extends Schema.TaggedError<FieldNotFoundError>()(
  "FieldNotFoundError",
  {
    code: Schema.Literal("FIELD_NOT_FOUND"),
    message: Schema.String,
    hint: NonEmptyString,
    meta: Schema.optional(DomainErrorMetaSchema),
  },
) {
  readonly statusCode = 400;

  constructor(field: string, availableFields: readonly string[]) {
    super({
      code: "FIELD_NOT_FOUND",
      message: `Field "${field}" was not found on this item.`,
      hint: formatAvailableFields(availableFields),
      meta: {
        field,
        availableFields: [...availableFields],
      },
    });
  }
}

export class MultiFieldItemError extends Schema.TaggedError<MultiFieldItemError>()(
  "MultiFieldItemError",
  {
    code: Schema.Literal("MULTI_FIELD_ITEM"),
    message: Schema.String,
    hint: NonEmptyString,
    meta: Schema.optional(DomainErrorMetaSchema),
  },
) {
  readonly statusCode = 400;

  constructor(availableFields: readonly string[]) {
    super({
      code: "MULTI_FIELD_ITEM",
      message: "This item has multiple fields. Specify which field to deliver.",
      hint: formatAvailableFields(availableFields),
      meta: {
        availableFields: [...availableFields],
      },
    });
  }
}

export type DomainError =
  | BadRequestError
  | ValidationError
  | UnauthorizedError
  | ForbiddenError
  | NotFoundError
  | ConflictError
  | RateLimitError
  | IntegrityError
  | FieldNotFoundError
  | MultiFieldItemError;

export function isDomainError(error: unknown): error is DomainError {
  return (
    error instanceof BadRequestError ||
    error instanceof ValidationError ||
    error instanceof UnauthorizedError ||
    error instanceof ForbiddenError ||
    error instanceof NotFoundError ||
    error instanceof ConflictError ||
    error instanceof RateLimitError ||
    error instanceof IntegrityError ||
    error instanceof FieldNotFoundError ||
    error instanceof MultiFieldItemError
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
  hint: string;
  meta?: Readonly<Record<string, unknown>>;
  issues?: ReadonlyArray<Schema.Schema.Type<typeof ValidationIssueSchema>>;
} {
  if (error instanceof ValidationError) {
    return {
      code: error.code,
      message: error.message,
      hint: error.hint,
      meta: error.meta,
      issues: error.issues,
    };
  }
  return {
    code: error.code as ErrorCode,
    message: error.message,
    hint: error.hint,
    meta: error.meta,
  };
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
    hint: "Check the invalid input fields and try again.",
    issues,
  });
}

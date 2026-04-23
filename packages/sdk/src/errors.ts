import type { ErrorCode } from "@abadge/core";
import { normalizeTrpcError } from "./trpc";
import type { ValidationIssue } from "./validation-issue";
import { toValidationIssues } from "./validation-issue";
export type { ValidationIssue } from "./validation-issue";

/**
 * Error thrown by all SDK client methods when an API request fails.
 *
 * Includes a machine-readable {@link code} field typed as `ErrorCode | string`
 * (the union preserves backward compatibility while enabling exhaustive checks
 * for known error codes) and the HTTP {@link statusCode} for programmatic
 * error handling.
 *
 * @example
 * ```typescript
 * try {
 *   await client.getProfile(profileId);
 * } catch (err) {
 *   if (err instanceof AbadgeApiError && err.code === "PROFILE_NOT_FOUND") {
 *     // handle missing profile
 *   }
 * }
 * ```
 */
export class AbadgeApiError extends Error {
  /** HTTP status code from the API response (e.g. 400, 401, 403, 404, 409, 429). */
  public readonly statusCode: number;

  /**
   * Machine-readable error code.
   *
   * Known codes are members of the `ErrorCode` union exported from `@abadge/core`
   * (e.g. `"PROFILE_NOT_FOUND"`, `"PERMISSION_DENIED"`, `"UNAUTHORIZED"`).
   * Unknown server codes or tRPC transport codes fall back to plain strings,
   * so the type is `ErrorCode | string` to stay backward-compatible.
   */
  public readonly code: ErrorCode | string;

  /** Operator-facing remediation guidance, if provided by the API. */
  public readonly hint?: string;

  /** Structured debugging metadata for advanced callers and JSON output. */
  public readonly meta?: Readonly<Record<string, unknown>>;

  /**
   * Per-field validation errors, present when `code === "VALIDATION_ERROR"`.
   *
   * Each entry carries a `path` (array of string/number segments identifying the
   * offending field, e.g. `["body", "email"]`) and a `message` describing the
   * constraint violation. Absent when the error is not a validation error or
   * when the server did not include field-level detail.
   *
   * @example
   * ```typescript
   * if (err instanceof AbadgeApiError && err.code === "VALIDATION_ERROR") {
   *   for (const issue of err.issues ?? []) {
   *     console.error(`${issue.path.join(".")}: ${issue.message}`);
   *   }
   * }
   * ```
   */
  public readonly issues?: ReadonlyArray<ValidationIssue>;

  constructor(
    statusCode: number,
    code: ErrorCode | string,
    message: string,
    hint?: string,
    meta?: Readonly<Record<string, unknown>>,
    issues?: ReadonlyArray<ValidationIssue>,
  ) {
    super(message);
    this.name = "AbadgeApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.hint = hint;
    this.meta = meta;
    this.issues = issues;
  }

  /**
   * Construct from a raw fetch Response. Attempts to parse the JSON body for code and message.
   *
   * @param res - The HTTP response
   * @param fallback - Message to use if the response body cannot be parsed
   */
  static async fromResponse(res: Response, fallback: string): Promise<AbadgeApiError> {
    let code: ErrorCode | string = "UNKNOWN";
    let message = fallback;
    let hint: string | undefined;
    let meta: Readonly<Record<string, unknown>> | undefined;
    let issues: ReadonlyArray<ValidationIssue> | undefined;
    try {
      const body = (await res.json()) as {
        error?: string;
        code?: string;
        hint?: string;
        meta?: Record<string, unknown>;
        issues?: unknown;
      };
      code = body.code ?? code;
      message = body.error ?? message;
      hint = body.hint;
      meta = body.meta;
      issues = toValidationIssues(body.issues);
    } catch {
      // Non-JSON response body
    }
    return new AbadgeApiError(res.status, code, message, hint, meta, issues);
  }

  /**
   * Construct from an unknown error (typically a tRPC client error). Normalizes the
   * error into a consistent AbadgeApiError with statusCode, code, and message.
   *
   * @param error - The caught error
   * @param fallback - Message to use if the error cannot be parsed
   */
  static fromUnknown(error: unknown, fallback: string): AbadgeApiError {
    const normalized = normalizeTrpcError(error);
    return new AbadgeApiError(
      normalized.httpStatus ?? 500,
      normalized.code ?? normalized.trpcCode ?? "UNKNOWN",
      normalized.message || fallback,
      normalized.hint,
      normalized.meta,
      normalized.issues,
    );
  }
}

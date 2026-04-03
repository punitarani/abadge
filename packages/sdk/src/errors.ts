import { normalizeTrpcError } from "./trpc";

/**
 * Error thrown by all AbadgeClient methods when an API request fails.
 *
 * Includes a machine-readable `code` (e.g. "VAULT_NOT_FOUND", "PERMISSION_DENIED")
 * and the HTTP `statusCode` for programmatic error handling.
 *
 * @example
 * ```typescript
 * try {
 *   await client.getVault();
 * } catch (err) {
 *   if (err instanceof AbadgeApiError && err.code === "VAULT_NOT_FOUND") {
 *     // handle missing vault
 *   }
 * }
 * ```
 */
export class AbadgeApiError extends Error {
  /** HTTP status code from the API response (e.g. 400, 401, 403, 404, 409, 429). */
  public readonly statusCode: number;
  /** Machine-readable error code (e.g. "VAULT_NOT_FOUND", "PERMISSION_DENIED", "UNAUTHORIZED"). */
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "AbadgeApiError";
    this.statusCode = statusCode;
    this.code = code;
  }

  /**
   * Construct from a raw fetch Response. Attempts to parse the JSON body for code and message.
   *
   * @param res - The HTTP response
   * @param fallback - Message to use if the response body cannot be parsed
   */
  static async fromResponse(res: Response, fallback: string): Promise<AbadgeApiError> {
    let code = "UNKNOWN";
    let message = fallback;
    try {
      const body = (await res.json()) as { error?: string; code?: string };
      code = body.code ?? code;
      message = body.error ?? message;
    } catch {
      // Non-JSON response body
    }
    return new AbadgeApiError(res.status, code, message);
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
      normalized.appCode ?? normalized.trpcCode ?? "UNKNOWN",
      normalized.message || fallback,
    );
  }
}

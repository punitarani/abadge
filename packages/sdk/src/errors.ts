import { normalizeTrpcError } from "@abadge/trpc/client";

export class AbadgeApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "AbadgeApiError";
    this.statusCode = statusCode;
    this.code = code;
  }

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

  static fromUnknown(error: unknown, fallback: string): AbadgeApiError {
    const normalized = normalizeTrpcError(error);
    return new AbadgeApiError(
      normalized.httpStatus ?? 500,
      normalized.appCode ?? normalized.trpcCode ?? "UNKNOWN",
      normalized.message || fallback,
    );
  }
}

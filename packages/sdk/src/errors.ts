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
}

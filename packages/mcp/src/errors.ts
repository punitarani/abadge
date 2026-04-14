import { AbadgeApiError } from "@abadge/sdk";

/**
 * Build the JSON error envelope surfaced to the LLM tool response. Preserves
 * the `AbadgeApiError` `{ code, message, hint, meta }` envelope so the model
 * can act on actionable remediation guidance instead of the bare message.
 *
 * `fallback` is used when the caught value is not an `Error` (unknown throw).
 */
export function toErrorPayload(err: unknown, fallback = "Unknown error"): Record<string, unknown> {
  if (err instanceof AbadgeApiError) {
    return {
      error: err.message,
      code: err.code,
      ...(err.hint ? { hint: err.hint } : {}),
      ...(err.meta ? { meta: err.meta } : {}),
    };
  }
  const message = err instanceof Error ? err.message : fallback;
  return { error: message };
}

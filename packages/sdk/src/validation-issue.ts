/**
 * A single field-level validation error returned by the API on VALIDATION_ERROR responses.
 *
 * `path` is the dot-separated field address (e.g. `["body", "email"]`).
 * `message` is a human-readable description of the constraint violation.
 */
export interface ValidationIssue {
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
}

/**
 * Defensively parse an unknown value into a typed ValidationIssue array.
 *
 * Returns undefined if:
 * - `input` is not an array
 * - ANY element lacks a valid `path` (array of string/number) or `message` (string)
 *
 * Conservative: malformed issues array is treated as absent rather than partial.
 */
export function toValidationIssues(input: unknown): ReadonlyArray<ValidationIssue> | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }
  const result: ValidationIssue[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") {
      return undefined;
    }
    const { path, message } = item as Record<string, unknown>;
    if (!Array.isArray(path)) {
      return undefined;
    }
    for (const segment of path) {
      if (typeof segment !== "string" && typeof segment !== "number") {
        return undefined;
      }
    }
    if (typeof message !== "string") {
      return undefined;
    }
    result.push({ path: path as ReadonlyArray<string | number>, message });
  }
  return result;
}

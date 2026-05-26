/**
 * §AB-0091 — structured-logging redaction guard.
 *
 * Nothing in the access/reveal path logs decrypted secrets today (verified by
 * grep + the guard test in `access-no-secret-logging.test.ts`). This helper is
 * the prescribed way to log any structured data that *might* carry a secret —
 * masking known secret-bearing keys before it reaches Workers observability —
 * so a future debug log can't silently turn into a persistent plaintext leak.
 */

// Keys whose values are (or can contain) plaintext secrets, ciphertext, or key
// material. Matched case-insensitively against object keys at every depth.
const SECRET_KEY =
  /^(value|fields|payload|password|secret|token|plaintext|apikey|privatekey|wrappedrootkey|recoverywrappedrootkey|ciphertext|encrypteditemkey|serverciphertext|kdfsalt)$/i;

const REDACTED = "[redacted]";

/**
 * Recursively returns a copy of `input` with any secret-bearing key's value
 * replaced by `"[redacted]"`. Non-objects pass through unchanged. Safe to
 * `JSON.stringify` the result for logging.
 */
export function redactSecrets(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map(redactSecrets);
  }
  if (input !== null && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      out[key] = SECRET_KEY.test(key) ? REDACTED : redactSecrets(value);
    }
    return out;
  }
  return input;
}

/** Convenience: stringify a value with secret-bearing keys redacted. */
export function redactedJson(input: unknown): string {
  return JSON.stringify(redactSecrets(input));
}

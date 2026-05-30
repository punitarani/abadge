import { inspect } from "node:util";

const REDACTED_SECRET = "[REDACTED]";

/**
 * Wrapper for a sensitive string that resists accidental disclosure. The raw
 * value is held in a private field and is reachable only through the explicit
 * {@link expose} call; every implicit stringification path — `JSON.stringify`,
 * `String()`/template literals, and `util.inspect`/`console.log` — yields
 * `[REDACTED]` instead. Use it to keep secrets out of logs, error messages, and
 * serialized payloads. Note that the value lives in plain JS memory, so this
 * guards against leaks, not against an attacker who can read process memory.
 */
export class SecretValue {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  /** Return the underlying secret. The only path that reveals the raw value. */
  expose(): string {
    return this.#value;
  }

  toJSON(): string {
    return REDACTED_SECRET;
  }

  toString(): string {
    return REDACTED_SECRET;
  }

  [inspect.custom](): string {
    return `SecretValue(${REDACTED_SECRET})`;
  }
}

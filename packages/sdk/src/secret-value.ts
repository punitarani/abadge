import { inspect } from "node:util";

const REDACTED_SECRET = "[REDACTED]";

export class SecretValue {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

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

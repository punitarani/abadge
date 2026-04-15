import { AbadgeApiError } from "@abadge/sdk";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

export function success(msg: string): void {
  console.log(`${GREEN}✓${RESET} ${msg}`);
}

export function error(msg: string): void {
  console.error(`${RED}✗${RESET} ${msg}`);
}

export function warn(msg: string): void {
  console.error(`${YELLOW}!${RESET} ${msg}`);
}

export function table(rows: Record<string, string>[]): void {
  if (rows.length === 0) {
    console.log("(no results)");
    return;
  }

  const keys = Object.keys(rows[0] ?? {});
  const widths = keys.map((k) => Math.max(k.length, ...rows.map((r) => (r[k] ?? "").length)));

  const header = keys.map((k, i) => `${BOLD}${k.padEnd(widths[i] ?? 0)}${RESET}`).join("  ");
  console.log(header);
  console.log(widths.map((w) => "─".repeat(w)).join("  "));

  for (const row of rows) {
    const line = keys.map((k, i) => (row[k] ?? "").padEnd(widths[i] ?? 0)).join("  ");
    console.log(line);
  }
}

export function json(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

/** Extract a user-facing message from an unknown catch value, including API hint if present. */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof AbadgeApiError) {
    return err.hint ? `${err.message}\n  ${DIM}→ ${err.hint}${RESET}` : err.message;
  }
  return err instanceof Error ? err.message : fallback;
}

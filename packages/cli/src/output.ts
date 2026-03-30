const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

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

/** Extract a string from parseArgs values (which return string | boolean unions with strict: false). */
export function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Extract error message from an unknown catch value. */
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

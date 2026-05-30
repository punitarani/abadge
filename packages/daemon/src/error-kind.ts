import { RPC_ERRORS } from "./types";

/**
 * Classify a daemon error so callers can give an accurate, actionable message
 * instead of a one-size-fits-all "start the daemon" hint that misleads a user
 * whose daemon IS running but whose vault is locked.
 *
 * - `locked`      — the vault needs unlocking (`RPC_ERRORS.VAULT_LOCKED`).
 * - `unreachable` — the daemon process isn't running / the socket is gone
 *                   (the client rejects with "Cannot connect to vaultd: …").
 * - `auth`        — no operator session (`RPC_ERRORS.AUTH_REQUIRED`).
 * - `other`       — anything else (wrong field, decrypt/AAD failure, etc.).
 */
export type DaemonErrorKind = "locked" | "unreachable" | "auth" | "other";

export function daemonErrorKind(err: unknown): DaemonErrorKind {
  const e = err as { code?: unknown; message?: unknown } | null | undefined;
  if (e && typeof e.code === "number") {
    if (e.code === RPC_ERRORS.VAULT_LOCKED) return "locked";
    if (e.code === RPC_ERRORS.AUTH_REQUIRED) return "auth";
  }
  // Node socket errors expose a string `code` (ENOENT when the socket file is
  // gone, ECONNREFUSED when nothing is listening); the daemon client also wraps
  // them as "Cannot connect to vaultd: …". Treat all of these as daemon-down.
  if (e && (e.code === "ENOENT" || e.code === "ECONNREFUSED")) return "unreachable";
  if (
    e &&
    typeof e.message === "string" &&
    (e.message.includes("Cannot connect to vaultd") ||
      e.message.includes("ECONNREFUSED") ||
      e.message.includes("ENOENT"))
  ) {
    return "unreachable";
  }
  return "other";
}

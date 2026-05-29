import { normalizeTrpcError } from "@abadge/trpc/client";
import { getClientErrorMessage } from "@/lib/client-error-message";

/**
 * Pure decision logic for the delete-workspace dialog, split out from the
 * component so it can be unit-tested without rendering or mocking the tRPC
 * client. Imports only env-free modules (never the `trpc-browser` barrel, which
 * constructs a client at import time).
 */

export interface DeleteGate {
  /** The typed name matches the workspace name (the specificity gate). */
  nameMatches: boolean;
  /** Both gates pass and no request is in flight. */
  canSubmit: boolean;
}

/**
 * Evaluate the two confirmation gates. Typing the name proves the user knows
 * *which* workspace they are deleting; a non-empty password lets the server
 * re-authenticate. The name comparison is trimmed so trailing whitespace in the
 * input never blocks an otherwise-correct confirmation.
 */
export function evaluateDeleteGate(params: {
  confirmText: string;
  confirmName: string;
  password: string;
  pending: boolean;
}): DeleteGate {
  const nameMatches = params.confirmText.trim() === params.confirmName;
  return {
    nameMatches,
    canSubmit: nameMatches && params.password.length > 0 && !params.pending,
  };
}

/** Where a failed deletion should surface in the UI. */
export type DeletionFailure =
  | { kind: "password"; message: string }
  | { kind: "form"; message: string }
  | { kind: "gone" };

/**
 * Map a failed `organizations.delete` call to where its message belongs:
 *   - `password`: a wrong password — the one failure the user fixes in place,
 *     so it goes on the password field.
 *   - `gone`: the workspace was already deleted (e.g. from another tab); the
 *     desired end state, so treat it as success rather than an error.
 *   - `form`: everything else (no password set on a social-login account, the
 *     name changed under us, insufficient role, or an unexpected failure) gets
 *     a persistent banner inside the dialog.
 */
export function classifyDeletionError(error: unknown, fallback: string): DeletionFailure {
  const { code } = normalizeTrpcError(error);
  if (code === "REAUTH_FAILED") {
    return { kind: "password", message: "Incorrect password. Please try again." };
  }
  if (code === "NOT_FOUND") {
    return { kind: "gone" };
  }
  return { kind: "form", message: getClientErrorMessage(error, fallback) };
}

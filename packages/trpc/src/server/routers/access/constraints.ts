import type { AgentLocality, StorageMode } from "@abadge/core";
import { ForbiddenError } from "@abadge/core";

/**
 * §RM-PR2 — Runtime constraints replacing the compile-time CAPABILITY_MATRIX.
 *
 * The canonical `read`/`use` actions are evaluated against agent locality and
 * item storage mode at access time. Two combinations are illegal:
 *
 *  - remote + zero_knowledge (any action) — the server cannot decrypt ZK
 *    items, and a remote agent has no daemon to decrypt them locally.
 *  - remote + use (any storage mode) — `use` returns a mount handle that a
 *    local daemon resolves into env-var or file delivery. There is no daemon
 *    on the remote side to honor it.
 *
 * Both checks raise ForbiddenError with code "INVALID_CAPABILITY"; the
 * remote+ZK rule fires first so the hint always points to the strongest
 * mismatch.
 */

export type AccessAction = "read" | "use";

export interface ConstraintInput {
  action: AccessAction;
  locality: AgentLocality;
  storageMode: StorageMode;
}

export function checkActionConstraint({ action, locality, storageMode }: ConstraintInput): void {
  if (locality === "remote" && storageMode === "zero_knowledge") {
    throw new ForbiddenError({
      code: "INVALID_CAPABILITY",
      message: "Remote agents cannot access zero-knowledge items.",
      hint: "Move this item to a server-managed profile, or run the agent locally with the daemon.",
      meta: { action, locality, storageMode },
    });
  }
  if (locality === "remote" && action === "use") {
    throw new ForbiddenError({
      code: "INVALID_CAPABILITY",
      message: "Remote agents cannot 'use' secrets (no local daemon to mount into).",
      hint: "Use 'read' on a server-managed item to receive the value over the wire instead.",
      meta: { action, locality, storageMode },
    });
  }
}

export function isActionAllowed(input: ConstraintInput): boolean {
  try {
    checkActionConstraint(input);
    return true;
  } catch {
    return false;
  }
}

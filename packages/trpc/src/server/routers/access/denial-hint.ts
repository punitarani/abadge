import type { Capability } from "@abadge/core";

/**
 * Identifiers needed to render a copy-pasteable `abadge permission create`
 * command in a permission-denied hint. All optional: at the deprecated
 * item-target denial sites the agent/item/capability are always known, but
 * keeping them optional lets callers that lack a field still produce the
 * generic guidance.
 */
export interface DenialHintTarget {
  agentId?: string;
  itemId?: string;
  /**
   * Canonical action (`read`/`use`) or a legacy capability name
   * (`read_ciphertext`, etc.). `abadge permission create --capability` accepts
   * both, so either is a valid paste target.
   */
  capability?: Capability;
}

/**
 * Machine-readable denial detail attached to `ForbiddenError.meta` so API/MCP
 * consumers can reconstruct the grant programmatically. Only the fields that
 * are known at the denial site are present.
 */
export type PermissionDeniedMeta = {
  itemId?: string;
  agentId?: string;
  capability?: Capability;
  action?: string;
};

/**
 * Build the human-facing hint for a missing-grant denial. The denied caller is
 * an agent, which cannot grant its own access — so the hint names the human
 * actor and, when the identifiers are known, an exact command they can run.
 *
 * Only use this for genuine no-grant denials. Locality/limit denials
 * (remote-agent-cannot-mount, profile-too-large) are NOT fixable by
 * `permission create` and must keep their own specific hints.
 */
export function buildPermissionDeniedHint(target: DenialHintTarget): string {
  const base =
    "No valid permission. A person with management access must grant this — " +
    "in the dashboard Permissions page";

  if (target.agentId && target.itemId && target.capability) {
    return (
      `${base}, or run \`abadge permission create --agent-id ${target.agentId} ` +
      `--item-id ${target.itemId} --capability ${target.capability}\`. ` +
      "The agent cannot grant its own access."
    );
  }

  return (
    `${base}, or run \`abadge permission create --agent-id <id> --item-id <id> ` +
    "--capability <cap>`. The agent cannot grant its own access."
  );
}

/**
 * Build the `meta` payload for a missing-grant denial, dropping any field that
 * is unknown at the call site so consumers never see `undefined` keys.
 */
export function buildPermissionDeniedMeta(
  target: DenialHintTarget & { action?: string },
): PermissionDeniedMeta {
  const meta: PermissionDeniedMeta = {};
  if (target.itemId) meta.itemId = target.itemId;
  if (target.agentId) meta.agentId = target.agentId;
  if (target.capability) meta.capability = target.capability;
  if (target.action) meta.action = target.action;
  return meta;
}

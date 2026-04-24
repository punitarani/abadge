import { ForbiddenError } from "@abadge/core";
import type { Database } from "@abadge/db";
import { and, eq, isNotNull, or } from "@abadge/db";
import { member, profiles } from "@abadge/db/schema";

/**
 * Onboarding completeness gate.
 *
 * "An organization is fully set up" ≡ it has at least one bootstrapped
 * profile. Bootstrapped means:
 *   - storageMode === 'server_managed'   (no client-side key required), OR
 *   - storageMode === 'zero_knowledge' AND wrappedRootKey IS NOT NULL
 *     (the ZK profile has completed its client-side KDF + wrap).
 *
 * "A user is fully set up" ≡ they belong to at least one fully-set-up org.
 *
 * We gate at-use (every scoped / agent call) instead of only at issuance, so
 * that deleting the last bootstrapped profile immediately disables downstream
 * CLI and agent sessions on the next request instead of waiting for token
 * expiry. Bootstrap itself does NOT go through `scopedSessionProcedure`
 * (profiles.create / profiles.bootstrap are `sessionProcedure`), so gating
 * scoped calls does not create a chicken-and-egg.
 *
 * Mirrors `isProfileBootstrapped` in
 * `apps/web/src/app/onboarding/onboarding-triage.ts`; they must stay in sync.
 */

export const ONBOARDING_INCOMPLETE_CODE = "ONBOARDING_INCOMPLETE";

function incompleteOrgError(orgId: string): ForbiddenError {
  return new ForbiddenError({
    code: ONBOARDING_INCOMPLETE_CODE,
    message: "Organization onboarding is not complete",
    hint: "Finish onboarding for this organization (create or bootstrap a profile) before using the API, CLI, MCP, or agents.",
    meta: { organizationId: orgId },
  });
}

function noUsableOrgError(userId: string): ForbiddenError {
  return new ForbiddenError({
    code: ONBOARDING_INCOMPLETE_CODE,
    message: "No fully set-up organization",
    hint: "Complete onboarding (create or join an organization and set up a profile) before approving CLI logins or authenticating agents.",
    meta: { userId },
  });
}

/**
 * Resolve whether an org has at least one bootstrapped profile. Returns
 * `true`/`false` rather than throwing, so callers can use the result in
 * conditionals (e.g. surfacing UI state via the `onboarding.status` query).
 */
export async function orgHasBootstrappedProfile(db: Database, orgId: string): Promise<boolean> {
  const rows = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(
      and(
        eq(profiles.organizationId, orgId),
        or(eq(profiles.storageMode, "server_managed"), isNotNull(profiles.wrappedRootKey)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Throw ONBOARDING_INCOMPLETE if the org lacks a bootstrapped profile.
 * Used by `scopedSessionProcedure` (user at-use), `agentProcedure` (agent
 * at-use), and `exchangeAgentSession` (agent at-issuance).
 */
export async function assertOrgOnboardingComplete(db: Database, orgId: string): Promise<void> {
  if (!(await orgHasBootstrappedProfile(db, orgId))) {
    throw incompleteOrgError(orgId);
  }
}

/**
 * True iff the user has at least one org membership where that org has a
 * bootstrapped profile. Used by the device-approval pre-check and the
 * `onboarding.status` query. Single join query — no N+1 across memberships.
 */
export async function userHasUsableOrg(db: Database, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: profiles.id })
    .from(member)
    .innerJoin(profiles, eq(profiles.organizationId, member.organizationId))
    .where(
      and(
        eq(member.userId, userId),
        or(eq(profiles.storageMode, "server_managed"), isNotNull(profiles.wrappedRootKey)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Throw ONBOARDING_INCOMPLETE if the user has no usable org. Currently
 * unused (the device-approval path surfaces the check via the `userHasUsableOrg`
 * predicate + client-side UI), but exported for future use at auth-layer
 * gates where throwing is more ergonomic than a predicate.
 */
export async function assertUserHasUsableOrg(db: Database, userId: string): Promise<void> {
  if (!(await userHasUsableOrg(db, userId))) {
    throw noUsableOrgError(userId);
  }
}

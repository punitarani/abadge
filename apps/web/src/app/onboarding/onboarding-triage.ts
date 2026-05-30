/**
 * Pure helpers for the onboarding flow. Kept free of React and network
 * calls so they are trivially testable.
 */

export interface TriageProfile {
  id: string;
  storageMode: "zero_knowledge" | "server_managed";
  wrappedRootKey: string | null;
}

/**
 * A profile is "bootstrapped" (usable) when:
 * - it is server_managed (no client-side key needed), OR
 * - it is zero_knowledge and has a wrappedRootKey set.
 *
 * `resolve-profile.ts` uses this to tell an unbootstrapped orphan profile
 * (safe to adopt) apart from a real profile we must never clobber.
 */
export function isProfileBootstrapped(p: TriageProfile): boolean {
  if (p.storageMode === "server_managed") return true;
  return p.wrappedRootKey !== null;
}

export interface ResumeOrgSummary {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  hasBootstrappedProfile: boolean;
}

export type ResumeAction = { kind: "redirect" } | { kind: "fall-through" };

/**
 * Decide what the onboarding page should do on mount.
 *
 * - Any org at all  -> redirect to the dashboard. Every org created through
 *                      the normal flow is auto-seeded with a usable
 *                      `server_managed` profile, so it is immediately usable.
 *                      An admin who deleted the default profile recovers from
 *                      the profiles page, not onboarding.
 * - No orgs         -> fall through to the choose screen so the user can
 *                      create their first org or paste an invite token.
 */
export function decideResumeAction(orgs: ReadonlyArray<ResumeOrgSummary>): ResumeAction {
  if (orgs.length > 0) return { kind: "redirect" };
  return { kind: "fall-through" };
}

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
 * A profile is considered "bootstrapped" (usable) when:
 * - it is server_managed (no client-side key needed), OR
 * - it is zero_knowledge and has a wrappedRootKey set.
 *
 * Historically also enforced server-side via the onboarding-completeness
 * gate; that gate was dropped in §REVAMP-PR3 Task 5.2 once
 * `organizations.create` started auto-seeding a default profile. This
 * helper survives because `resolve-profile.ts` still uses it to decide
 * whether an "already exists" profile is an unbootstrapped orphan we may
 * adopt, or a real profile we must never clobber.
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
 * §REVAMP-PR5 (Task 9.1) — Decide what the onboarding page should do on
 * mount when the user already has one or more orgs.
 *
 * - Any org at all  -> redirect to the dashboard. With PR3's auto-default
 *                      profile, every org created through the normal flow
 *                      already has a usable `server_managed` profile.
 *                      If an admin somehow has an unbootstrapped org (e.g.
 *                      they deleted the default profile), the profiles page
 *                      surfaces the recovery path — not onboarding.
 * - No orgs         -> fall through to the choose screen so the user can
 *                      create their first org or paste an invite token.
 */
export function decideResumeAction(orgs: ReadonlyArray<ResumeOrgSummary>): ResumeAction {
  if (orgs.length > 0) return { kind: "redirect" };
  return { kind: "fall-through" };
}

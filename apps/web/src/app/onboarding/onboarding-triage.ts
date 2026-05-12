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

export type ResumeAction =
  | { kind: "redirect" }
  | { kind: "resume-profile"; org: ResumeOrgSummary }
  | { kind: "fall-through" };

/**
 * Decide what the onboarding page should do on mount when the user already
 * has one or more orgs:
 * - any usable org (bootstrapped profile)  -> redirect to the dashboard
 * - org exists but no usable profile        -> resume on the create-profile step
 * - no orgs                                 -> fall through to the choose screen
 *
 * Note on multi-org behavior: the previous `decideOnboardingStateFromList`
 * eagerly resumed the first INCOMPLETE org even when other orgs were
 * bootstrapped. This version prefers redirect — if you have any usable
 * org you are not blocked, and the dashboard's org switcher lets you
 * fix the incomplete one later. This is more permissive on purpose;
 * `tests/onboarding-triage.test.ts` pins the new behavior.
 */
export function decideResumeAction(orgs: ReadonlyArray<ResumeOrgSummary>): ResumeAction {
  const usable = orgs.find((o) => o.hasBootstrappedProfile);
  if (usable) return { kind: "redirect" };
  const incomplete = orgs[0];
  if (incomplete) return { kind: "resume-profile", org: incomplete };
  return { kind: "fall-through" };
}

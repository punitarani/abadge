/**
 * Pure logic for deciding how to resume onboarding when the user already has
 * one or more orgs. Kept free of React and network calls so it is testable
 * with bun:test.
 */

export interface TriageProfile {
  id: string;
  storageMode: "zero_knowledge" | "server_managed";
  wrappedRootKey: string | null;
}

export interface TriageOrg {
  id: string;
  name: string;
  slug: string;
  profiles: TriageProfile[];
}

export type OnboardingDecision =
  | { step: "step1" }
  | { step: "step2"; orgId: string; orgSlug: string; orgName: string }
  | { step: "redirect" };

/**
 * A profile is considered "bootstrapped" (usable) when:
 * - it is server_managed (no client-side key needed), OR
 * - it is zero_knowledge and has a wrappedRootKey set.
 *
 * Profiles auto-created by `organizations.create` start as zero_knowledge
 * with wrappedRootKey === null and are therefore treated as unbootstrapped.
 */
export function isProfileBootstrapped(p: TriageProfile): boolean {
  if (p.storageMode === "server_managed") return true;
  return p.wrappedRootKey !== null;
}

/** An org needs bootstrapping when none of its profiles is bootstrapped. */
export function orgNeedsBootstrap(org: TriageOrg): boolean {
  if (org.profiles.length === 0) return true;
  return !org.profiles.some(isProfileBootstrapped);
}

/**
 * Decide how to render onboarding given the user's current orgs:
 * - no orgs -> show step 1 (create org)
 * - any org is incomplete -> resume at step 2 for that org
 * - all orgs are complete -> redirect to overview
 */
export function decideOnboardingState(orgs: TriageOrg[]): OnboardingDecision {
  if (orgs.length === 0) return { step: "step1" };

  const incomplete = orgs.find(orgNeedsBootstrap);
  if (incomplete) {
    return {
      step: "step2",
      orgId: incomplete.id,
      orgSlug: incomplete.slug,
      orgName: incomplete.name,
    };
  }

  return { step: "redirect" };
}

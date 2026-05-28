/**
 * Pure decision logic for the dashboard layout's auth/org gate. Kept free of
 * React and network calls so it is trivially testable (mirrors the
 * `onboarding-triage.ts` split). The gate in `layout.tsx` applies whatever
 * action this returns.
 */

export interface OrgSummary {
  id: string;
  slug: string;
  name: string;
  logo: string | null;
}

export type LayoutDecision =
  | { kind: "wait" }
  | { kind: "redirect"; to: string }
  | { kind: "adopt"; org: OrgSummary }
  | { kind: "ready" };

/**
 * Decide what the dashboard gate should do for the current auth/org state.
 *
 * Rules (in order): wait for hydration/session, redirect unauthenticated to
 * login, wait for the orgs query to succeed, redirect to /onboarding only when
 * the user has NO org at all, adopt the first org when the stored one is
 * missing or stale, otherwise the layout is ready.
 *
 * Membership in any org is sufficient to enter the dashboard. This MUST agree
 * with onboarding's `decideResumeAction` ("any org -> redirect to dashboard"):
 * if the two disagree about an org, the user ping-pongs between /overview and
 * /onboarding forever. An org whose default profile was deleted is still
 * usable — the per-page profiles flow surfaces the recovery path, so the gate
 * never bounces such an org back to onboarding.
 */
export function decideLayoutAction(args: {
  hydrated: boolean;
  sessionPending: boolean;
  session: unknown;
  orgsStatus: "pending" | "error" | "success";
  orgs: OrgSummary[];
  activeOrgId: string | null;
}): LayoutDecision {
  if (!args.hydrated || args.sessionPending) return { kind: "wait" };
  if (!args.session) return { kind: "redirect", to: "/login" };
  if (args.orgsStatus !== "success") return { kind: "wait" };
  if (args.orgs.length === 0) return { kind: "redirect", to: "/onboarding" };

  const storedValid = args.activeOrgId != null && args.orgs.some((o) => o.id === args.activeOrgId);
  if (storedValid) return { kind: "ready" };

  const first = args.orgs[0];
  if (!first) return { kind: "redirect", to: "/onboarding" };
  return { kind: "adopt", org: first };
}

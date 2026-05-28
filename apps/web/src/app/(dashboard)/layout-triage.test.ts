import { describe, expect, test } from "bun:test";
import { decideLayoutAction, type OrgSummary } from "./layout-triage";

function org(overrides: Partial<OrgSummary> = {}): OrgSummary {
  return { id: "org-1", slug: "acme", name: "Acme", logo: null, ...overrides };
}

const base = {
  hydrated: true,
  sessionPending: false,
  session: { user: { id: "u1" } },
  orgsStatus: "success" as const,
  orgs: [org()],
  activeOrgId: "org-1",
};

describe("decideLayoutAction", () => {
  test("waits until store has hydrated", () => {
    expect(decideLayoutAction({ ...base, hydrated: false })).toEqual({ kind: "wait" });
  });

  test("waits while the session is still resolving", () => {
    expect(decideLayoutAction({ ...base, sessionPending: true })).toEqual({ kind: "wait" });
  });

  test("redirects unauthenticated users to /login", () => {
    expect(decideLayoutAction({ ...base, session: null })).toEqual({
      kind: "redirect",
      to: "/login",
    });
  });

  test("waits while the orgs query has not succeeded", () => {
    expect(decideLayoutAction({ ...base, orgsStatus: "pending" })).toEqual({ kind: "wait" });
    expect(decideLayoutAction({ ...base, orgsStatus: "error" })).toEqual({ kind: "wait" });
  });

  test("redirects to /onboarding only when the user has no org at all", () => {
    expect(decideLayoutAction({ ...base, orgs: [], activeOrgId: null })).toEqual({
      kind: "redirect",
      to: "/onboarding",
    });
  });

  // Regression: a profile-less org must NOT bounce back to onboarding.
  // Onboarding's decideResumeAction redirects any org to the dashboard, so if
  // the dashboard rejected such an org the two would loop forever (HAR showed
  // organizations.list refetching every ~0.7s). Membership alone is enough;
  // the profiles page handles the missing-profile recovery.
  test("a stored org the user belongs to is ready, regardless of profile state", () => {
    expect(
      decideLayoutAction({ ...base, orgs: [org({ id: "org-1" })], activeOrgId: "org-1" }),
    ).toEqual({ kind: "ready" });
  });

  test("adopts the first org when no active org is stored", () => {
    const only = org({ id: "org-9", slug: "nine", name: "Nine" });
    expect(decideLayoutAction({ ...base, orgs: [only], activeOrgId: null })).toEqual({
      kind: "adopt",
      org: only,
    });
  });

  test("adopts the first org when the stored active org is stale", () => {
    const only = org({ id: "org-9", slug: "nine", name: "Nine" });
    expect(decideLayoutAction({ ...base, orgs: [only], activeOrgId: "deleted-org" })).toEqual({
      kind: "adopt",
      org: only,
    });
  });
});

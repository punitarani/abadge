import { describe, expect, test } from "bun:test";
import {
  decideResumeAction,
  isProfileBootstrapped,
  type ResumeOrgSummary,
} from "./onboarding-triage";

const zkUnboot = { id: "p1", storageMode: "zero_knowledge", wrappedRootKey: null } as const;
const zkBoot = { id: "p2", storageMode: "zero_knowledge", wrappedRootKey: "wrap" } as const;
const srvMgd = { id: "p3", storageMode: "server_managed", wrappedRootKey: null } as const;

describe("isProfileBootstrapped", () => {
  test("server_managed profile is always bootstrapped", () => {
    expect(isProfileBootstrapped(srvMgd)).toBe(true);
  });

  test("zero_knowledge profile with wrappedRootKey is bootstrapped", () => {
    expect(isProfileBootstrapped(zkBoot)).toBe(true);
  });

  test("zero_knowledge profile without wrappedRootKey is not bootstrapped", () => {
    expect(isProfileBootstrapped(zkUnboot)).toBe(false);
  });
});

function org(overrides: Partial<ResumeOrgSummary>): ResumeOrgSummary {
  return {
    id: "org-1",
    name: "Acme",
    slug: "acme",
    logo: null,
    hasBootstrappedProfile: false,
    ...overrides,
  };
}

describe("decideResumeAction (§REVAMP-PR5: single-step onboarding)", () => {
  test("no orgs -> fall-through (show the choose screen)", () => {
    expect(decideResumeAction([])).toEqual({ kind: "fall-through" });
  });

  test("any orgs at all -> redirect (auto-default profile exists)", () => {
    // PR3 auto-creates a server_managed default profile when an org is
    // created, so any org coming back from the list is usable. We trust
    // the dashboard and the profiles page to surface recovery flows for
    // the edge case where an admin deleted the default profile.
    expect(decideResumeAction([org({ hasBootstrappedProfile: true })])).toEqual({
      kind: "redirect",
    });
    expect(decideResumeAction([org({ hasBootstrappedProfile: false })])).toEqual({
      kind: "redirect",
    });
    expect(decideResumeAction([org({ id: "a" }), org({ id: "b" })])).toEqual({
      kind: "redirect",
    });
  });
});

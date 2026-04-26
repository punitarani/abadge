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

describe("decideResumeAction", () => {
  test("no orgs -> fall-through (show the choose screen)", () => {
    expect(decideResumeAction([])).toEqual({ kind: "fall-through" });
  });

  test("single bootstrapped org -> redirect", () => {
    expect(decideResumeAction([org({ hasBootstrappedProfile: true })])).toEqual({
      kind: "redirect",
    });
  });

  test("single unbootstrapped org -> resume-profile for that org", () => {
    const target = org({ id: "o1", slug: "s1", name: "N1" });
    expect(decideResumeAction([target])).toEqual({ kind: "resume-profile", org: target });
  });

  test("multiple bootstrapped orgs -> redirect", () => {
    const a = org({ id: "a", hasBootstrappedProfile: true });
    const b = org({ id: "b", hasBootstrappedProfile: true });
    expect(decideResumeAction([a, b])).toEqual({ kind: "redirect" });
  });

  test("mix of bootstrapped + unbootstrapped -> redirect (do not block on the incomplete sibling)", () => {
    // Behavioral pin: this differs from the previous decideOnboardingStateFromList,
    // which eagerly resumed the first incomplete org even when others were
    // bootstrapped. A user with any usable org is not blocked, and the
    // dashboard's org switcher lets them fix the incomplete one later.
    const usable = org({ id: "u", hasBootstrappedProfile: true });
    const broken = org({ id: "b", hasBootstrappedProfile: false });
    expect(decideResumeAction([broken, usable])).toEqual({ kind: "redirect" });
    expect(decideResumeAction([usable, broken])).toEqual({ kind: "redirect" });
  });

  test("multiple unbootstrapped orgs -> resume-profile for the first one in list order", () => {
    const a = org({ id: "first" });
    const b = org({ id: "second" });
    expect(decideResumeAction([a, b])).toEqual({ kind: "resume-profile", org: a });
  });
});

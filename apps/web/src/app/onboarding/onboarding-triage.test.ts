import { describe, expect, test } from "bun:test";
import {
  decideOnboardingState,
  isProfileBootstrapped,
  orgNeedsBootstrap,
  type TriageOrg,
} from "./onboarding-triage";

const zkUnboot = { id: "p1", storageMode: "zero_knowledge", wrappedRootKey: null } as const;
const zkBoot = { id: "p2", storageMode: "zero_knowledge", wrappedRootKey: "wrap" } as const;
const srvMgd = { id: "p3", storageMode: "server_managed", wrappedRootKey: null } as const;

function org(overrides: Partial<TriageOrg>): TriageOrg {
  return {
    id: "org-1",
    name: "Acme",
    slug: "acme",
    profiles: [],
    ...overrides,
  };
}

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

describe("orgNeedsBootstrap", () => {
  test("org with no profiles needs bootstrap", () => {
    expect(orgNeedsBootstrap(org({ profiles: [] }))).toBe(true);
  });

  test("org with only unbootstrapped ZK profiles needs bootstrap", () => {
    expect(orgNeedsBootstrap(org({ profiles: [zkUnboot] }))).toBe(true);
  });

  test("org with a bootstrapped ZK profile does not need bootstrap", () => {
    expect(orgNeedsBootstrap(org({ profiles: [zkUnboot, zkBoot] }))).toBe(false);
  });

  test("org with a server_managed profile does not need bootstrap", () => {
    expect(orgNeedsBootstrap(org({ profiles: [srvMgd] }))).toBe(false);
  });
});

describe("decideOnboardingState", () => {
  test("no orgs -> step1", () => {
    expect(decideOnboardingState([])).toEqual({ step: "step1" });
  });

  test("single incomplete org -> step2 for that org", () => {
    const incomplete = org({ id: "o1", slug: "s1", name: "N1", profiles: [zkUnboot] });
    expect(decideOnboardingState([incomplete])).toEqual({
      step: "step2",
      orgId: "o1",
      orgSlug: "s1",
      orgName: "N1",
    });
  });

  test("single complete org -> redirect", () => {
    const complete = org({ profiles: [zkBoot] });
    expect(decideOnboardingState([complete])).toEqual({ step: "redirect" });
  });

  test("mix of complete and incomplete -> resume the incomplete one", () => {
    const complete = org({ id: "o-done", slug: "done", name: "Done", profiles: [zkBoot] });
    const incomplete = org({ id: "o-todo", slug: "todo", name: "Todo", profiles: [zkUnboot] });
    expect(decideOnboardingState([complete, incomplete])).toEqual({
      step: "step2",
      orgId: "o-todo",
      orgSlug: "todo",
      orgName: "Todo",
    });
  });

  test("multiple complete orgs -> redirect", () => {
    const a = org({ id: "a", profiles: [zkBoot] });
    const b = org({ id: "b", profiles: [srvMgd] });
    expect(decideOnboardingState([a, b])).toEqual({ step: "redirect" });
  });
});

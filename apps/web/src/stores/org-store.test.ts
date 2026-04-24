import { describe, expect, test } from "bun:test";
import { useOrgStore } from "./org-store";

describe("useOrgStore.clearActiveOrg", () => {
  test("clears all active org state after being populated", () => {
    useOrgStore.getState().setActiveOrg({
      id: "org_123",
      slug: "test",
      name: "Test Org",
      logo: null,
    });
    expect(useOrgStore.getState().activeOrgId).toBe("org_123");
    expect(useOrgStore.getState().activeOrgSlug).toBe("test");
    expect(useOrgStore.getState().activeOrgName).toBe("Test Org");

    useOrgStore.getState().clearActiveOrg();

    expect(useOrgStore.getState().activeOrgId).toBeNull();
    expect(useOrgStore.getState().activeOrgSlug).toBeNull();
    expect(useOrgStore.getState().activeOrgName).toBeNull();
    expect(useOrgStore.getState().activeOrgLogo).toBeNull();
  });

  test("is idempotent when called on already-clear state", () => {
    useOrgStore.getState().clearActiveOrg();
    useOrgStore.getState().clearActiveOrg();
    expect(useOrgStore.getState().activeOrgId).toBeNull();
  });
});

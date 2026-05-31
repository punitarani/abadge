import { describe, expect, test } from "bun:test";
import type { Profile } from "@abadge/core";
import { defaultProfileId, profileOptionLabel } from "./profile-select";

function mkProfile(p: Partial<Profile> & Pick<Profile, "id" | "name" | "storageMode">): Profile {
  return {
    organizationId: "org_1",
    externalId: null,
    description: null,
    wrappedRootKey: null,
    kdfSalt: null,
    kdfParams: null,
    recoveryWrappedRootKey: null,
    keyVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...p,
  } as Profile;
}

describe("defaultProfileId", () => {
  test("prefers the org's default profile (externalId='default')", () => {
    const profiles = [
      mkProfile({ id: "p_zk", name: "secrets", storageMode: "zero_knowledge" }),
      mkProfile({
        id: "p_def",
        name: "default",
        storageMode: "server_managed",
        externalId: "default",
      }),
    ];
    expect(defaultProfileId(profiles)).toBe("p_def");
  });

  test("falls back to the first profile when there is no 'default'", () => {
    const profiles = [
      mkProfile({ id: "p_a", name: "a", storageMode: "server_managed", externalId: "cust_a" }),
      mkProfile({ id: "p_b", name: "b", storageMode: "zero_knowledge" }),
    ];
    expect(defaultProfileId(profiles)).toBe("p_a");
  });

  test("returns undefined for an empty list", () => {
    expect(defaultProfileId([])).toBeUndefined();
  });
});

describe("profileOptionLabel", () => {
  test("shows the name and a friendly storage mode", () => {
    expect(
      profileOptionLabel(mkProfile({ id: "p", name: "default", storageMode: "server_managed" })),
    ).toBe("default · server-managed");
    expect(
      profileOptionLabel(mkProfile({ id: "p", name: "secrets", storageMode: "zero_knowledge" })),
    ).toBe("secrets · zero-knowledge");
  });
});

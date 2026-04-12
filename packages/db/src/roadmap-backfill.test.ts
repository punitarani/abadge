import { describe, expect, test } from "bun:test";
import {
  buildDefaultProfileFromVault,
  buildPersonalMembership,
  buildPersonalOrganization,
  buildRoadmapAgent,
  migratedItemLabel,
  personalOrganizationIdForUser,
  personalOrganizationSlugForUser,
  resolveServerManagedBackfillLabel,
} from "./roadmap-backfill";

describe("personal organization backfill helpers", () => {
  test("creates deterministic personal organization identifiers per user", () => {
    expect(personalOrganizationIdForUser("user_123")).toBe("org_personal_user_123");
    expect(personalOrganizationSlugForUser("User 123")).toBe("personal-user-123");
  });

  test("builds a personal org + owner membership payload", () => {
    expect(
      buildPersonalOrganization({
        id: "user-1",
        name: "Punit",
        email: "punit@example.com",
      }),
    ).toEqual({
      id: "org_personal_user-1",
      name: "Punit Personal",
      slug: "personal-user-1",
      metadata: JSON.stringify({
        kind: "personal",
        migratedFromUserId: "user-1",
      }),
    });

    expect(buildPersonalMembership("user-1")).toEqual({
      id: "member_personal_user-1",
      organizationId: "org_personal_user-1",
      userId: "user-1",
      role: "owner",
    });
  });
});

describe("profile backfill helpers", () => {
  test("copies zero-knowledge vault material into the default profile envelope", () => {
    const profile = buildDefaultProfileFromVault("org_personal_user-1", {
      id: "vault-1",
      wrappedRootKey: "wrapped-root-key",
      kdfSalt: "salt",
      kdfParams: {
        algorithm: "argon2id",
        memory: 65536,
        iterations: 3,
        parallelism: 1,
        hashLength: 32,
      },
      recoveryWrappedRootKey: "wrapped-recovery-key",
      keyVersion: 3,
      createdAt: new Date("2026-04-11T00:00:00.000Z"),
      updatedAt: new Date("2026-04-11T01:00:00.000Z"),
    });

    expect(profile).toMatchObject({
      id: "profile_default_vault-1",
      organizationId: "org_personal_user-1",
      name: "default",
      storageMode: "zero_knowledge",
      keyVersion: 3,
    });
  });
});

describe("item label backfill helpers", () => {
  test("uses deterministic labels for zero-knowledge items", () => {
    expect(migratedItemLabel("item-123456789")).toBe("migrated-item-123");
  });

  test("extracts the cleartext label from decrypted server-managed payloads", () => {
    expect(
      resolveServerManagedBackfillLabel(
        "item-1",
        JSON.stringify({
          v: 1,
          label: "Production API key",
          kind: "api_key",
          fields: { value: "secret" },
        }),
      ),
    ).toBe("Production API key");
  });

  test("falls back to a deterministic label when the decrypted payload is legacy or malformed", () => {
    expect(resolveServerManagedBackfillLabel("item-legacy", "raw-secret-value")).toBe(
      "migrated-item-leg",
    );
  });
});

describe("agent backfill helpers", () => {
  test("maps legacy principal kinds into the roadmap agent model", () => {
    expect(
      buildRoadmapAgent({
        id: "agent-1",
        userId: "user-1",
        kind: "device",
        name: "Workstation",
        authMethod: "legacy_api_key",
        enabled: true,
        createdAt: new Date("2026-04-11T00:00:00.000Z"),
      }),
    ).toMatchObject({
      organizationId: "org_personal_user-1",
      createdBy: "user-1",
      kind: "local_cli",
      locality: "local",
    });
  });
});

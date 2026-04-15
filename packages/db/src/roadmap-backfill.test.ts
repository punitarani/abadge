import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serverEncrypt } from "@abadge/crypto/server";
import {
  backfillServerManagedItemLabels,
  buildDefaultProfileFromVault,
  buildPersonalMembership,
  buildPersonalOrganization,
  buildRoadmapAgent,
  migratedItemLabel,
  personalOrganizationIdForUser,
  personalOrganizationSlugForUser,
  resolveServerManagedBackfillLabel,
} from "./roadmap-backfill";

const migrationSql = readFileSync(
  join(import.meta.dir, "../migrations/0006_v0_foundation_cutover.sql"),
  "utf8",
);
const packageJson = JSON.parse(readFileSync(join(import.meta.dir, "../package.json"), "utf8")) as {
  scripts?: Record<string, string>;
};

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

  test("migration backfills every item label and makes the column required", () => {
    expect(migrationSql).toContain('UPDATE "items"');
    expect(migrationSql).toContain('SET "label" =');
    expect(migrationSql).toContain('WHERE "label" IS NULL OR "label" = \'\';');
    expect(migrationSql).toContain('ALTER TABLE "items" ALTER COLUMN "label" SET NOT NULL;');
    expect(migrationSql).not.toContain("Server-managed labels require app-layer decryption");
  });

  test("runtime backfill decrypts server-managed payloads and updates migrated labels, including deleted rows", async () => {
    const encryptionKey = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
      "base64",
    );
    const encrypted = await serverEncrypt(
      new TextEncoder().encode(
        JSON.stringify({
          v: 1,
          label: "Backfilled from payload",
          kind: "opaque",
          fields: { value: "secret" },
        }),
      ),
      encryptionKey,
      1,
    );

    const updates: Array<{ id: string; label: string }> = [];
    const db = {
      listServerManagedItems: async () => [
        {
          id: "item-1",
          label: migratedItemLabel("item-1"),
          serverCiphertext: encrypted.ciphertext,
          serverIv: encrypted.iv,
          serverKeyVersion: encrypted.keyVersion,
        },
        {
          id: "item-deleted-1",
          label: migratedItemLabel("item-deleted-1"),
          serverCiphertext: encrypted.ciphertext,
          serverIv: encrypted.iv,
          serverKeyVersion: encrypted.keyVersion,
        },
      ],
      updateItemLabel: async (id: string, label: string) => {
        updates.push({ id, label });
      },
    } as const;

    const result = await backfillServerManagedItemLabels({
      db,
      encryptionKey,
    });

    expect(result).toEqual({ scanned: 2, updated: 2 });
    expect(updates).toEqual([
      { id: "item-1", label: "Backfilled from payload" },
      { id: "item-deleted-1", label: "Backfilled from payload" },
    ]);
  });

  test("db migrate script runs the roadmap runtime backfill", () => {
    expect(packageJson.scripts?.["db:migrate"]).toContain("roadmap-backfill.ts");
    expect(packageJson.scripts?.["db:push"]).toContain("roadmap-backfill.ts");
  });
});

describe("audit log migration invariants", () => {
  test("does not add foreign keys to append-only audit logs", () => {
    expect(migrationSql).not.toContain("audit_logs_organization_id_organization_id_fk");
    expect(migrationSql).not.toContain("audit_logs_profile_id_profiles_id_fk");
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

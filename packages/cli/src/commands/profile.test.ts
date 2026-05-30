import { describe, expect, test } from "bun:test";
import type { Profile } from "@abadge/core";
import { toProfileJsonDto } from "./profile";

describe("toProfileJsonDto", () => {
  const row: Profile = {
    id: "prof_1",
    organizationId: "org_1",
    name: "default",
    externalId: "default",
    description: "the default profile",
    storageMode: "zero_knowledge",
    wrappedRootKey: "wrapped-secret",
    kdfSalt: "salt-secret",
    kdfParams: {
      algorithm: "argon2id",
      memory: 19456,
      iterations: 2,
      parallelism: 1,
      hashLength: 32,
    },
    recoveryWrappedRootKey: "recovery-secret",
    keyVersion: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  };

  test("keeps the public fields", () => {
    expect(toProfileJsonDto(row)).toEqual({
      id: "prof_1",
      name: "default",
      externalId: "default",
      description: "the default profile",
      storageMode: "zero_knowledge",
      keyVersion: 3,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
  });

  test("drops wrapped-key and KDF columns", () => {
    const dto = toProfileJsonDto(row) as Record<string, unknown>;
    expect(dto.wrappedRootKey).toBeUndefined();
    expect(dto.kdfSalt).toBeUndefined();
    expect(dto.kdfParams).toBeUndefined();
    expect(dto.recoveryWrappedRootKey).toBeUndefined();
    expect(dto.organizationId).toBeUndefined();
  });
});

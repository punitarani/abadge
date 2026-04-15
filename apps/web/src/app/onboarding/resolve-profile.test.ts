import { describe, expect, mock, test } from "bun:test";
import type { Profile } from "@abadge/core";
import { type ProfileResolverClient, resolveOrCreateProfile } from "./resolve-profile";

/**
 * `normalizeTrpcError` reads the application error code off `error.data.code`.
 * Stubbed errors here ape that shape so the helper sees the code we expect
 * without dragging the full tRPC error class into the test.
 */
function trpcError(code: string, message = "stubbed"): Error {
  const err = new Error(message) as Error & { data: { code: string } };
  err.data = { code };
  return err;
}

function profile(overrides: Partial<Profile>): Profile {
  return {
    id: "p_default",
    name: "default",
    description: null,
    organizationId: "org_1",
    storageMode: "zero_knowledge",
    wrappedRootKey: null,
    kdfSalt: null,
    kdfParams: null,
    recoveryWrappedRootKey: null,
    keyVersion: 1,
    createdAt: "2026-04-04T15:23:00.000Z",
    updatedAt: "2026-04-04T15:23:00.000Z",
    ...overrides,
  } as Profile;
}

function makeClient(overrides: {
  createImpl?: ProfileResolverClient["profiles"]["create"]["mutate"];
  listImpl?: ProfileResolverClient["profiles"]["list"]["query"];
}): ProfileResolverClient & {
  createMock: ReturnType<typeof mock>;
  listMock: ReturnType<typeof mock>;
} {
  const createMock = mock(overrides.createImpl ?? (async () => ({ profile: { id: "p_new" } })));
  const listMock = mock(overrides.listImpl ?? (async () => ({ profiles: [] })));
  return {
    profiles: {
      create: { mutate: createMock as ProfileResolverClient["profiles"]["create"]["mutate"] },
      list: { query: listMock as ProfileResolverClient["profiles"]["list"]["query"] },
    },
    createMock,
    listMock,
  };
}

describe("resolveOrCreateProfile", () => {
  test("happy path: returns id of newly created profile", async () => {
    const client = makeClient({});
    const id = await resolveOrCreateProfile(client, {
      orgId: "org_1",
      name: "default",
      storageMode: "zero_knowledge",
    });

    expect(id).toBe("p_new");
    expect(client.createMock).toHaveBeenCalledTimes(1);
    expect(client.listMock).toHaveBeenCalledTimes(0);
  });

  test("PROFILE_ALREADY_EXISTS + unbootstrapped sibling: adopts existing id", async () => {
    const existing = profile({
      id: "p_orphan",
      name: "default",
      storageMode: "zero_knowledge",
      wrappedRootKey: null,
    });
    const client = makeClient({
      createImpl: async () => {
        throw trpcError("PROFILE_ALREADY_EXISTS");
      },
      listImpl: async () => ({ profiles: [existing] }),
    });

    const id = await resolveOrCreateProfile(client, {
      orgId: "org_1",
      name: "default",
      storageMode: "zero_knowledge",
    });

    expect(id).toBe("p_orphan");
    expect(client.createMock).toHaveBeenCalledTimes(1);
    expect(client.listMock).toHaveBeenCalledTimes(1);
  });

  test("PROFILE_ALREADY_EXISTS + bootstrapped sibling: rethrows (never clobbers)", async () => {
    const existing = profile({
      id: "p_real",
      name: "default",
      storageMode: "zero_knowledge",
      wrappedRootKey: "fake-wrapped-key",
    });
    const client = makeClient({
      createImpl: async () => {
        throw trpcError("PROFILE_ALREADY_EXISTS", "exists already");
      },
      listImpl: async () => ({ profiles: [existing] }),
    });

    await expect(
      resolveOrCreateProfile(client, {
        orgId: "org_1",
        name: "default",
        storageMode: "zero_knowledge",
      }),
    ).rejects.toThrow("exists already");
  });

  test("non-PROFILE_ALREADY_EXISTS error is rethrown without listing", async () => {
    const client = makeClient({
      createImpl: async () => {
        throw trpcError("INTERNAL_SERVER_ERROR", "boom");
      },
    });

    await expect(
      resolveOrCreateProfile(client, {
        orgId: "org_1",
        name: "default",
        storageMode: "zero_knowledge",
      }),
    ).rejects.toThrow("boom");
    expect(client.listMock).toHaveBeenCalledTimes(0);
  });

  test("PROFILE_ALREADY_EXISTS but no matching name in list: rethrows", async () => {
    const other = profile({ id: "p_other", name: "other-name" });
    const client = makeClient({
      createImpl: async () => {
        throw trpcError("PROFILE_ALREADY_EXISTS", "exists");
      },
      listImpl: async () => ({ profiles: [other] }),
    });

    await expect(
      resolveOrCreateProfile(client, {
        orgId: "org_1",
        name: "default",
        storageMode: "zero_knowledge",
      }),
    ).rejects.toThrow("exists");
  });
});

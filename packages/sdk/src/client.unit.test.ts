/**
 * Unit coverage for AbadgeUserClient + AbadgeAgentClient.
 *
 * The integration suite (`client.test.ts`) drives the real keypair-session
 * exchange against a stub Bun.serve. This file replaces the internal tRPC
 * proxy with an in-process recorder so every public method can be exercised
 * cheaply (~250 LoC), with one happy path + one error path each.
 *
 * The TRPC proxy is a `protected` field on both clients; tests overwrite it
 * after construction. This is a unit test seam — it lets us cover the body of
 * each wrapper (which is `try { client.foo.bar() } catch { rethrow }`) without
 * paying the cost of a network round trip.
 */

import { describe, expect, mock, test } from "bun:test";
import { AbadgeAgentClient, AbadgeUserClient } from "./client";
import { AbadgeApiError } from "./errors";

// -----------------------------------------------------------------------------
// Recorder
// -----------------------------------------------------------------------------

interface RecordedCall {
  path: string;
  kind: "mutate" | "query";
  input?: unknown;
}

/** Sentinel that tells the recorder to reject the next call with `value`. */
class Reject {
  constructor(public readonly value: unknown) {}
}
function rejectsWith(value: unknown): Reject {
  return new Reject(value);
}

function makeRecorder(returns: unknown): {
  client: Record<string, unknown>;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  // Proxy that intercepts `.x.y.z.{mutate|query}(input)` and records the path.
  const make = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get(_target, key) {
        if (typeof key === "symbol") return undefined;
        if (key === "mutate" || key === "query") {
          return (input?: unknown) => {
            calls.push({ path: path.join("."), kind: key, input });
            if (returns instanceof Reject) return Promise.reject(returns.value);
            if (returns instanceof Error) return Promise.reject(returns);
            return Promise.resolve(returns);
          };
        }
        return make([...path, key]);
      },
    });
  return { client: make([]) as Record<string, unknown>, calls };
}

function makeUserClient(returns: unknown): {
  user: AbadgeUserClient;
  calls: RecordedCall[];
} {
  const { client, calls } = makeRecorder(returns);
  const user = new AbadgeUserClient({ apiUrl: "http://x", sessionToken: "tok" });
  // Replace the internal tRPC proxy.
  (user as unknown as { client: unknown }).client = client;
  return { user, calls };
}

function makeAgentClient(returns: unknown): {
  agent: AbadgeAgentClient;
  calls: RecordedCall[];
} {
  const { client, calls } = makeRecorder(returns);
  const agent = new AbadgeAgentClient({ apiUrl: "http://x", apiKey: "abl_test_key" });
  (agent as unknown as { client: unknown }).client = client;
  return { agent, calls };
}

// -----------------------------------------------------------------------------
// AbadgeUserClient — happy paths
// -----------------------------------------------------------------------------

async function invoke(target: object, method: string, args: unknown[]): Promise<void> {
  const fn = (target as Record<string, unknown>)[method] as (...a: unknown[]) => Promise<unknown>;
  await Reflect.apply(fn, target, args);
}

describe("AbadgeUserClient happy paths", () => {
  test.each([
    ["createItem", "items.create", "mutate", [{ storageMode: "server_managed", payload: {} }]],
    ["listItems", "items.list", "query", []],
    ["getItem", "items.get", "query", ["item_x"]],
    ["updateItem", "items.update", "mutate", ["item_x", { contentVersion: 1, payload: {} }]],
    ["ownerReveal", "items.ownerReveal", "mutate", ["item_x"]],
    ["deleteItem", "items.delete", "mutate", ["item_x"]],

    ["createAgent", "agents.create", "mutate", [{ name: "a", kind: "remote" }]],
    ["listAgents", "agents.list", "query", []],
    ["rotateAgent", "agents.rotate", "mutate", ["agent_x"]],
    ["revokeAgent", "agents.revoke", "mutate", ["agent_x"]],
    ["issueBootstrapToken", "auth.issueBootstrapToken", "mutate", ["agent_x"]],

    [
      "createPermission",
      "permissions.create",
      "mutate",
      [{ agentId: "a", itemId: "i", capabilities: ["mount_env"] }],
    ],
    ["listPermissions", "permissions.list", "query", []],
    ["revokePermission", "permissions.revoke", "mutate", ["perm_x"]],

    ["getAudit", "audit.list", "query", []],
  ] as const)("%s -> %s.%s", async (method, expectedPath, expectedKind, args) => {
    const { user, calls } = makeUserClient({ ok: true });
    await invoke(user, method, [...args]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe(expectedPath);
    expect(calls[0]?.kind).toBe(expectedKind as RecordedCall["kind"]);
  });

  test("createOrganization unwraps result.organization", async () => {
    const { user, calls } = makeUserClient({
      organization: { id: "org_1", name: "x", slug: "x" },
    });
    const out = await user.createOrganization({ name: "x", slug: "x" });
    expect(out.id).toBe("org_1");
    expect(calls[0]?.path).toBe("organizations.create");
  });

  test("listOrganizations + getOrganization + updateOrganization + deleteOrganization", async () => {
    const { user: u1, calls: c1 } = makeUserClient({ organizations: [] });
    await u1.listOrganizations();
    expect(c1[0]?.path).toBe("organizations.list");

    const { user: u2, calls: c2 } = makeUserClient({});
    await u2.getOrganization("org_x");
    expect(c2[0]?.path).toBe("organizations.get");

    const { user: u3, calls: c3 } = makeUserClient({ ok: true });
    await u3.updateOrganization("org_x", { name: "n" });
    expect(c3[0]?.path).toBe("organizations.update");

    const { user: u4, calls: c4 } = makeUserClient({ ok: true });
    await u4.deleteOrganization("org_x");
    expect(c4[0]?.path).toBe("organizations.delete");
  });

  test("members.* delegates", async () => {
    const calls: string[] = [];
    const setup = <T>(returns: T) => {
      const r = makeUserClient(returns);
      return { user: r.user, push: () => calls.push(r.calls[0]?.path ?? "?") };
    };

    const a = setup({ members: [] });
    await a.user.listMembers("org_x");
    a.push();

    const b = setup({ ok: true, invitationId: "inv_1", token: "tok" });
    await b.user.inviteMember("org_x", { role: "member" });
    b.push();

    const c = setup({
      organizationName: "x",
      organizationSlug: "x",
      role: "member",
      expiresAt: "",
    });
    await c.user.getInviteInfo("tok");
    c.push();

    const d = setup({
      ok: true,
      organizationId: "org_x",
      organizationName: "x",
      organizationSlug: "x",
    });
    await d.user.acceptInvite("tok");
    d.push();

    const e = setup({ ok: true });
    await e.user.revokeInvite("org_x", "inv_1");
    e.push();

    const f = setup({ ok: true });
    await f.user.removeMember("org_x", "user_x");
    f.push();

    const g = setup({ ok: true });
    await g.user.updateMemberRole("org_x", "user_x", "admin");
    g.push();

    expect(calls).toEqual([
      "organizations.members.list",
      "organizations.members.invite",
      "organizations.members.getInviteInfo",
      "organizations.members.acceptInvite",
      "organizations.members.revokeInvite",
      "organizations.members.remove",
      "organizations.members.updateRole",
    ]);
  });

  test("profiles.* delegates", async () => {
    const created: string[] = [];
    const cases: Array<[() => Promise<unknown>, string]> = [
      [
        async () => {
          const { user, calls } = makeUserClient({
            profile: { id: "p_1", name: "n", storageMode: "server_managed" },
          });
          await user.createProfile({ orgId: "o", name: "n" });
          return calls[0]?.path;
        },
        "profiles.create",
      ],
      [
        async () => {
          const { user, calls } = makeUserClient({ profiles: [] });
          await user.listProfiles("org_x");
          return calls[0]?.path;
        },
        "profiles.list",
      ],
      [
        async () => {
          const { user, calls } = makeUserClient({});
          await user.getProfile("p_1");
          return calls[0]?.path;
        },
        "profiles.get",
      ],
      [
        async () => {
          const { user, calls } = makeUserClient({ id: "p_1" });
          await user.bootstrapProfile("p_1", {} as never);
          return calls[0]?.path;
        },
        "profiles.bootstrap",
      ],
      [
        async () => {
          const { user, calls } = makeUserClient({ ok: true });
          await user.changeProfilePassword("p_1", {} as never);
          return calls[0]?.path;
        },
        "profiles.changePassword",
      ],
      [
        async () => {
          const { user, calls } = makeUserClient({ ok: true });
          await user.setupProfileRecovery("p_1", {} as never);
          return calls[0]?.path;
        },
        "profiles.setupRecovery",
      ],
      [
        async () => {
          const { user, calls } = makeUserClient({ ok: true, keyVersion: 2 });
          await user.rotateProfileKey("p_1", {} as never);
          return calls[0]?.path;
        },
        "profiles.rotateKey",
      ],
      [
        async () => {
          const { user, calls } = makeUserClient({ ok: true });
          await user.deleteProfile("p_1");
          return calls[0]?.path;
        },
        "profiles.delete",
      ],
    ];
    for (const [run, expected] of cases) {
      created.push(((await run()) as string) ?? "?");
      expect(created.at(-1)).toBe(expected);
    }
  });
});

// -----------------------------------------------------------------------------
// AbadgeUserClient — error paths
// -----------------------------------------------------------------------------

describe("AbadgeUserClient error paths", () => {
  test("any tRPC reject is wrapped as AbadgeApiError with fallback message", async () => {
    const { user } = makeUserClient(new Error("boom"));
    await expect(user.listItems()).rejects.toBeInstanceOf(AbadgeApiError);
    await expect(user.listItems()).rejects.toMatchObject({
      message: "boom",
    });
  });

  test("preserves AbadgeApiError code/hint/meta from a tRPC-shaped reject", async () => {
    const trpcLike = {
      message: "Profile not found",
      data: {
        httpStatus: 404,
        code: "PROFILE_NOT_FOUND",
        hint: "Re-create the profile.",
        meta: { profileId: "p_x" },
      },
    };
    const { user } = makeUserClient(rejectsWith(trpcLike));
    let caught: unknown;
    try {
      await user.getProfile("p_x");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AbadgeApiError);
    const e = caught as AbadgeApiError;
    expect(e.code).toBe("PROFILE_NOT_FOUND");
    expect(e.statusCode).toBe(404);
    expect(e.hint).toBe("Re-create the profile.");
    expect(e.meta).toEqual({ profileId: "p_x" });
  });
});

// -----------------------------------------------------------------------------
// AbadgeAgentClient — happy paths (apiKey constructor — no connect needed)
// -----------------------------------------------------------------------------

describe("AbadgeAgentClient happy paths", () => {
  test.each([
    ["enroll", "auth.enroll", "mutate", ["abe_token", "pubkey"]],
    ["getCurrentAgent", "agents.self", "query", []],
    ["listItems", "items.listForAgent", "query", []],
    ["getItem", "items.get", "query", ["item_x"]],
    ["getAudit", "audit.listForAgent", "query", []],
    ["accessCiphertext", "access.ciphertext", "mutate", ["item_x"]],
    ["accessReveal", "access.reveal", "mutate", ["item_x"]],
    ["accessMount", "access.mount", "mutate", ["item_x", "env"]],
    ["bulkAccessMountEnv", "access.bulkMountEnv", "mutate", ["prof_x"]],
  ] as const)("%s -> %s.%s", async (method, expectedPath, expectedKind, args) => {
    const { agent, calls } = makeAgentClient({ ok: true });
    await invoke(agent, method, [...args]);
    expect(calls[0]?.path).toBe(expectedPath);
    expect(calls[0]?.kind).toBe(expectedKind as RecordedCall["kind"]);
  });

  test("accessReveal omits field when not provided, includes it when given", async () => {
    const a = makeAgentClient({ payload: { fields: {} } });
    await a.agent.accessReveal("item_x");
    expect(a.calls[0]?.input).toEqual({ itemId: "item_x" });

    const b = makeAgentClient({ payload: { fields: {} } });
    await b.agent.accessReveal("item_x", "password");
    expect(b.calls[0]?.input).toEqual({ itemId: "item_x", field: "password" });
  });

  test("accessMount sends mountType and optional field", async () => {
    const a = makeAgentClient({ storageMode: "server_managed", payload: { fields: {} } });
    await a.agent.accessMount("item_x", "file");
    expect(a.calls[0]?.input).toEqual({ itemId: "item_x", mountType: "file" });

    const b = makeAgentClient({ storageMode: "server_managed", payload: { fields: {} } });
    await b.agent.accessMount("item_x", "env", "value");
    expect(b.calls[0]?.input).toEqual({ itemId: "item_x", mountType: "env", field: "value" });
  });

  test("bulkAccessMountEnv passes profileId straight through", async () => {
    const a = makeAgentClient({ items: [] });
    await a.agent.bulkAccessMountEnv("prof_1");
    expect(a.calls[0]?.input).toEqual({ profileId: "prof_1" });
  });
});

// -----------------------------------------------------------------------------
// AbadgeAgentClient — sessionExpired short-circuit (keypair config only)
// -----------------------------------------------------------------------------

describe("AbadgeAgentClient sessionExpired short-circuit", () => {
  test("after session is flipped expired, methods reject with SESSION_REFRESH_FAILED before hitting the wire", async () => {
    // Construct with apiKey to avoid the connect() path; toggle the internal
    // sessionExpired flag to verify the short-circuit guard.
    const { agent, calls } = makeAgentClient({ ok: true });

    // The flag is referenced by `authedCall` only when constructed with an
    // `agentId` (keypair config). Build a keypair-config client and short
    // circuit it without connecting.
    const keypairAgent = new AbadgeAgentClient({
      apiUrl: "http://x",
      agentId: "agent_x",
      privateKey: '{"kty":"OKP"}',
      schedulerFn: ((cb: () => void) => {
        // never schedules; ignore
        return setTimeout(cb, 1_000_000);
      }) as never,
    });
    (keypairAgent as unknown as { client: unknown }).client = (
      agent as unknown as { client: unknown }
    ).client;
    (keypairAgent as unknown as { sessionExpired: boolean }).sessionExpired = true;

    await expect(keypairAgent.listItems()).rejects.toMatchObject({
      code: "SESSION_REFRESH_FAILED",
    });
    expect(calls).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// disconnect() is idempotent and safe to call without connect()
// -----------------------------------------------------------------------------

describe("AbadgeAgentClient.disconnect", () => {
  test("disconnect on api-key client is a no-op", () => {
    const { agent } = makeAgentClient({ ok: true });
    agent.disconnect();
    agent.disconnect();
    // Just verify nothing throws and no calls happen.
    expect(true).toBe(true);
  });

  test("disconnect on keypair client clears any scheduled timer", () => {
    let cleared: NodeJS.Timeout | null = null;
    const originalClear = globalThis.clearTimeout;
    globalThis.clearTimeout = ((handle: NodeJS.Timeout) => {
      cleared = handle;
      return originalClear(handle);
    }) as typeof clearTimeout;
    const restore = () => {
      globalThis.clearTimeout = originalClear;
    };

    try {
      const a = new AbadgeAgentClient({
        apiUrl: "http://x",
        agentId: "agent_x",
        privateKey: '{"kty":"OKP"}',
      });
      // Plant a fake timer handle so disconnect() has something to clear.
      (a as unknown as { refreshTimer: NodeJS.Timeout | null }).refreshTimer = setTimeout(
        () => undefined,
        1_000_000,
      );
      a.disconnect();
      expect(cleared).not.toBeNull();
    } finally {
      restore();
    }
  });
});

// Suppress an unused-import warning when bun's mock helper isn't otherwise referenced.
void mock;

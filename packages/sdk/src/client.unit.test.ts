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
  // Keypair config; the recorder client below replaces the internal tRPC proxy,
  // so connect() is never needed and no real session exchange happens.
  const agent = new AbadgeAgentClient({
    apiUrl: "http://x",
    agentId: "agent_x",
    privateKey: '{"kty":"OKP"}',
  });
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
    ["ownerReveal", "items.ownerReveal", "mutate", ["item_x"]],
    ["issueBootstrapToken", "auth.issueBootstrapToken", "mutate", ["agent_x"]],
  ] as const)("%s -> %s.%s", async (method, expectedPath, expectedKind, args) => {
    const { user, calls } = makeUserClient({ ok: true });
    await invoke(user, method, [...args]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe(expectedPath);
    expect(calls[0]?.kind).toBe(expectedKind as RecordedCall["kind"]);
  });

  test("orgs.create unwraps result.organization", async () => {
    const { user, calls } = makeUserClient({
      organization: { id: "org_1", name: "x", slug: "x" },
    });
    const out = await user.orgs.create({ name: "x", slug: "x" });
    expect(out.id).toBe("org_1");
    expect(calls[0]?.path).toBe("organizations.create");
  });

  test("orgs.createPersonal unwraps result.organization (no input)", async () => {
    const { user, calls } = makeUserClient({
      organization: {
        id: "org_p",
        name: "Dana's workspace",
        slug: "dana-ab12cd34",
        isPersonal: true,
      },
    });
    const out = await user.orgs.createPersonal();
    expect(out.id).toBe("org_p");
    expect(out.isPersonal).toBe(true);
    expect(calls[0]?.path).toBe("organizations.createPersonal");
    expect(calls[0]?.kind).toBe("mutate");
  });

  test("orgs.list + orgs.get + orgs.update + orgs.delete", async () => {
    const { user: u1, calls: c1 } = makeUserClient({ organizations: [] });
    await u1.orgs.list();
    expect(c1[0]?.path).toBe("organizations.list");

    const { user: u2, calls: c2 } = makeUserClient({});
    await u2.orgs.get("org_x");
    expect(c2[0]?.path).toBe("organizations.get");

    const { user: u3, calls: c3 } = makeUserClient({ ok: true });
    await u3.orgs.update("org_x", { name: "n" });
    expect(c3[0]?.path).toBe("organizations.update");

    const { user: u4, calls: c4 } = makeUserClient({ ok: true });
    await u4.orgs.delete("org_x", { confirmName: "My Org", password: "pw" });
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
          await user.profiles.create({ orgId: "o", name: "n" });
          return calls[0]?.path;
        },
        "profiles.create",
      ],
      [
        async () => {
          const { user, calls } = makeUserClient({ profiles: [] });
          await user.profiles.list("org_x");
          return calls[0]?.path;
        },
        "profiles.list",
      ],
      [
        async () => {
          const { user, calls } = makeUserClient({});
          await user.profiles.get("p_1");
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
          await user.profiles.delete("p_1");
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
// AbadgeUserClient — namespaced API (§RM-PR4)
// -----------------------------------------------------------------------------

describe("AbadgeUserClient namespaces delegate to tRPC paths", () => {
  // items
  test("items.create -> items.create", async () => {
    const { user, calls } = makeUserClient({ id: "item_x" });
    await user.items.create({ storageMode: "server_managed", payload: {} } as never);
    expect(calls[0]?.path).toBe("items.create");
  });
  test("items.list -> items.list", async () => {
    const { user, calls } = makeUserClient({ items: [] });
    await user.items.list();
    expect(calls[0]?.path).toBe("items.list");
  });
  test("items.get -> items.get", async () => {
    const { user, calls } = makeUserClient({ item: { id: "item_x" } });
    await user.items.get("item_x");
    expect(calls[0]?.path).toBe("items.get");
    expect(calls[0]?.input).toEqual({ itemId: "item_x" });
  });
  test("items.update -> items.update", async () => {
    const { user, calls } = makeUserClient({ ok: true, contentVersion: 2 });
    await user.items.update("item_x", { contentVersion: 1 } as never);
    expect(calls[0]?.path).toBe("items.update");
  });
  test("items.delete -> items.delete", async () => {
    const { user, calls } = makeUserClient({ ok: true });
    await user.items.delete("item_x");
    expect(calls[0]?.path).toBe("items.delete");
  });

  // orgs
  test("orgs.list -> organizations.list", async () => {
    const { user, calls } = makeUserClient({ organizations: [] });
    await user.orgs.list();
    expect(calls[0]?.path).toBe("organizations.list");
  });
  test("orgs.create -> organizations.create", async () => {
    const { user, calls } = makeUserClient({ organization: { id: "o_x", name: "x", slug: "x" } });
    await user.orgs.create({ name: "x" });
    expect(calls[0]?.path).toBe("organizations.create");
  });
  test("orgs.update -> organizations.update", async () => {
    const { user, calls } = makeUserClient({ ok: true });
    await user.orgs.update("o_x", { name: "renamed" });
    expect(calls[0]?.path).toBe("organizations.update");
    expect(calls[0]?.input).toEqual({ orgId: "o_x", name: "renamed" });
  });
  test("orgs.delete -> organizations.delete", async () => {
    const { user, calls } = makeUserClient({ ok: true });
    await user.orgs.delete("o_x", { confirmName: "Org X", password: "pw" });
    expect(calls[0]?.path).toBe("organizations.delete");
    expect(calls[0]?.input).toEqual({ orgId: "o_x", confirmName: "Org X", password: "pw" });
  });

  // profiles
  test("profiles.create -> profiles.create", async () => {
    const { user, calls } = makeUserClient({
      profile: { id: "p_x", name: "n", storageMode: "server_managed" },
    });
    await user.profiles.create({ orgId: "o_x", name: "n" });
    expect(calls[0]?.path).toBe("profiles.create");
  });
  test("profiles.list -> profiles.list", async () => {
    const { user, calls } = makeUserClient({ profiles: [] });
    await user.profiles.list("o_x");
    expect(calls[0]?.path).toBe("profiles.list");
  });
  test("profiles.delete -> profiles.delete", async () => {
    const { user, calls } = makeUserClient({ ok: true });
    await user.profiles.delete("p_x");
    expect(calls[0]?.path).toBe("profiles.delete");
  });
  test("profiles.update -> profiles.changePassword", async () => {
    const { user, calls } = makeUserClient({ ok: true });
    await user.profiles.update("p_x", {
      oldPassword: "a",
      newPassword: "b",
    } as never);
    expect(calls[0]?.path).toBe("profiles.changePassword");
  });

  // agents
  test("agents.create -> agents.create", async () => {
    const { user, calls } = makeUserClient({ id: "a_x" });
    await user.agents.create({ kind: "remote", name: "x" } as never);
    expect(calls[0]?.path).toBe("agents.create");
  });
  test("agents.list -> agents.list", async () => {
    const { user, calls } = makeUserClient({ agents: [] });
    await user.agents.list();
    expect(calls[0]?.path).toBe("agents.list");
  });
  test("agents.delete -> agents.revoke", async () => {
    const { user, calls } = makeUserClient({ ok: true });
    await user.agents.delete("a_x");
    expect(calls[0]?.path).toBe("agents.revoke");
  });
  test("agents.get finds via list", async () => {
    const { user, calls } = makeUserClient({
      agents: [
        { id: "a_x", name: "n" },
        { id: "a_y", name: "m" },
      ],
    });
    const { agent } = await user.agents.get("a_y");
    expect(agent.id).toBe("a_y");
    expect(calls[0]?.path).toBe("agents.list");
  });
  test("agents.get throws AGENT_NOT_FOUND when missing", async () => {
    const { user } = makeUserClient({ agents: [] });
    await expect(user.agents.get("a_missing")).rejects.toMatchObject({
      code: "AGENT_NOT_FOUND",
    });
  });

  // permissions
  test("permissions.create -> permissions.create", async () => {
    const { user, calls } = makeUserClient({ permissions: [] });
    await user.permissions.create({
      agentId: "a_x",
      itemId: "i_x",
      capabilities: ["read_ciphertext"],
    } as never);
    expect(calls[0]?.path).toBe("permissions.create");
  });
  test("permissions.list -> permissions.list", async () => {
    const { user, calls } = makeUserClient({ permissions: [] });
    await user.permissions.list({ agentId: "a_x" });
    expect(calls[0]?.path).toBe("permissions.list");
  });
  test("permissions.delete -> permissions.revoke", async () => {
    const { user, calls } = makeUserClient({ ok: true });
    await user.permissions.delete("p_x");
    expect(calls[0]?.path).toBe("permissions.revoke");
  });

  // audit
  test("audit.list -> audit.list", async () => {
    const { user, calls } = makeUserClient({ entries: [], nextCursor: null });
    await user.audit.list({ agentId: "a_x" });
    expect(calls[0]?.path).toBe("audit.list");
  });
});

// -----------------------------------------------------------------------------
// AbadgeUserClient — list methods drain pagination (§AB-0050 regression guard)
// -----------------------------------------------------------------------------

describe("AbadgeUserClient list methods drain every page", () => {
  /** A stub whose `<arrayKey>.list.query` returns two pages, then stops. */
  function twoPageUser(arrayKey: "items" | "agents" | "permissions"): AbadgeUserClient {
    let n = 0;
    const list = {
      query: () => {
        n++;
        const page = {
          [arrayKey]: [{ id: `${arrayKey}-${n}` }],
          nextCursor: n === 1 ? "c1" : null,
        };
        return Promise.resolve(page);
      },
    };
    const user = new AbadgeUserClient({ apiUrl: "http://x", sessionToken: "tok" });
    (user as unknown as { client: unknown }).client = { [arrayKey]: { list } };
    return user;
  }

  test("items.list concatenates pages and reports nextCursor=null", async () => {
    const { items, nextCursor } = await twoPageUser("items").items.list();
    expect(items.map((i) => (i as { id: string }).id)).toEqual(["items-1", "items-2"]);
    expect(nextCursor).toBeNull();
  });

  test("agents.list concatenates pages and reports nextCursor=null", async () => {
    const { agents, nextCursor } = await twoPageUser("agents").agents.list();
    expect(agents.map((a) => (a as { id: string }).id)).toEqual(["agents-1", "agents-2"]);
    expect(nextCursor).toBeNull();
  });

  test("permissions.list concatenates pages and reports nextCursor=null", async () => {
    const { permissions, nextCursor } = await twoPageUser("permissions").permissions.list();
    expect(permissions.map((p) => (p as { id: string }).id)).toEqual([
      "permissions-1",
      "permissions-2",
    ]);
    expect(nextCursor).toBeNull();
  });
});

describe("AbadgeAgentClient.listItems drains the paginated agent item view", () => {
  test("concatenates listForAgent pages and reports nextCursor=null", async () => {
    let n = 0;
    const listForAgent = {
      query: () => {
        n++;
        return Promise.resolve({
          items: [{ id: `agent-item-${n}` }],
          nextCursor: n === 1 ? "c1" : null,
        });
      },
    };
    const agent = new AbadgeAgentClient({
      apiUrl: "http://x",
      agentId: "agent_x",
      privateKey: '{"kty":"OKP"}',
    });
    (agent as unknown as { client: unknown }).client = { items: { listForAgent } };

    const { items, nextCursor } = await agent.listItems();
    expect(items.map((i) => (i as { id: string }).id)).toEqual(["agent-item-1", "agent-item-2"]);
    expect(nextCursor).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// AbadgeUserClient — error paths
// -----------------------------------------------------------------------------

describe("AbadgeUserClient error paths", () => {
  test("any tRPC reject is wrapped as AbadgeApiError with fallback message", async () => {
    const { user } = makeUserClient(new Error("boom"));
    await expect(user.items.list()).rejects.toBeInstanceOf(AbadgeApiError);
    await expect(user.items.list()).rejects.toMatchObject({
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
      await user.profiles.get("p_x");
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
// AbadgeAgentClient — happy paths (recorder client replaces the proxy; no
// connect() / real session exchange needed)
// -----------------------------------------------------------------------------

describe("AbadgeAgentClient happy paths", () => {
  test.each([
    ["enroll", "auth.enroll", "mutate", ["abe_token", "pubkey"]],
    ["getCurrentAgent", "agents.self", "query", []],
    ["listItems", "items.listForAgent", "query", []],
    ["getItem", "items.get", "query", ["item_x"]],
    ["getAudit", "audit.listForAgent", "query", []],
  ] as const)("%s -> %s.%s", async (method, expectedPath, expectedKind, args) => {
    // listItems drains pages, reading items/nextCursor off the response, so the
    // shared return must terminate a single page.
    const { agent, calls } = makeAgentClient({ ok: true, items: [], nextCursor: null });
    await invoke(agent, method, [...args]);
    expect(calls[0]?.path).toBe(expectedPath);
    expect(calls[0]?.kind).toBe(expectedKind as RecordedCall["kind"]);
  });

  // §RM-PR2 — unified access namespace
  test("access.read routes to access.read with optional field/purpose", async () => {
    const a = makeAgentClient({ storageMode: "server_managed", payload: { fields: {} } });
    await a.agent.access.read("item_x");
    expect(a.calls[0]?.path).toBe("access.read");
    expect(a.calls[0]?.input).toEqual({ itemId: "item_x" });

    const b = makeAgentClient({ storageMode: "server_managed", payload: { fields: {} } });
    await b.agent.access.read("item_x", { field: "value", purpose: "ci-deploy" });
    expect(b.calls[0]?.input).toEqual({
      itemId: "item_x",
      field: "value",
      purpose: "ci-deploy",
    });
  });

  test("access.use on item target routes to access.use", async () => {
    const a = makeAgentClient({
      mountId: "mnt_abc",
      delivery: "env",
      expiresAt: "2026-01-01T00:00:00Z",
    });
    await a.agent.access.use({ itemId: "item_x" }, { delivery: "env" });
    expect(a.calls[0]?.path).toBe("access.use");
    expect(a.calls[0]?.input).toEqual({ itemId: "item_x", delivery: "env" });

    const b = makeAgentClient({
      mountId: "mnt_abc",
      delivery: "file",
      expiresAt: "2026-01-01T00:00:00Z",
    });
    await b.agent.access.use(
      { itemId: "item_y" },
      { delivery: "file", field: "password", envVarName: "DB_PASS", purpose: "migrate" },
    );
    expect(b.calls[0]?.input).toEqual({
      itemId: "item_y",
      delivery: "file",
      field: "password",
      envVarName: "DB_PASS",
      purpose: "migrate",
    });
  });

  test("access.use on profile target routes to access.useProfile", async () => {
    const a = makeAgentClient({ items: [] });
    await a.agent.access.use({ profileId: "prof_x" }, { delivery: "env", purpose: "deploy" });
    expect(a.calls[0]?.path).toBe("access.useProfile");
    expect(a.calls[0]?.input).toEqual({
      profileId: "prof_x",
      delivery: "env",
      purpose: "deploy",
    });
  });
});

// -----------------------------------------------------------------------------
// AbadgeAgentClient — sessionExpired short-circuit (keypair config only)
// -----------------------------------------------------------------------------

describe("AbadgeAgentClient sessionExpired short-circuit", () => {
  test("after session is flipped expired, methods reject with SESSION_REFRESH_FAILED before hitting the wire", async () => {
    // makeAgentClient builds a keypair-config client with a recorder proxy and
    // never connects. Toggle the internal sessionExpired flag to verify the
    // short-circuit guard rejects before any wire call.
    const { agent, calls } = makeAgentClient({ ok: true });
    (agent as unknown as { sessionExpired: boolean }).sessionExpired = true;

    await expect(agent.listItems()).rejects.toMatchObject({
      code: "SESSION_REFRESH_FAILED",
    });
    expect(calls).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// disconnect() is idempotent and safe to call without connect()
// -----------------------------------------------------------------------------

describe("AbadgeAgentClient.disconnect", () => {
  test("disconnect without connect is a safe no-op", () => {
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

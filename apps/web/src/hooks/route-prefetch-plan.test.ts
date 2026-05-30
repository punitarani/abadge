import { describe, expect, test } from "bun:test";
import { dashboardQueryKeys } from "@/lib/query-keys";
import {
  buildPrefetchPlan,
  type PrefetchableRoute,
  type PrefetchClient,
} from "./route-prefetch-plan";

const ORG_ID = "org-test-123";

/**
 * Stub client whose every procedure returns a sentinel string that includes
 * the procedure name. Lets the test assert which fetcher each PrefetchEntry's
 * queryFn ends up calling, without doing any network work.
 */
function makeStubClient(): {
  client: PrefetchClient;
  calls: { proc: string; args: unknown }[];
} {
  const calls: { proc: string; args: unknown }[] = [];
  // The list procedures are drained by the planner, so their stub must return a
  // single-page shape (`nextCursor: null`) carrying every possible array key.
  const record = (proc: string) => (args?: unknown) => {
    calls.push({ proc, args });
    return Promise.resolve({ items: [], agents: [], permissions: [], nextCursor: null });
  };
  return {
    calls,
    client: {
      profiles: { list: { query: record("profiles.list") } },
      items: { list: { query: record("items.list") } },
      agents: { list: { query: record("agents.list") } },
      permissions: { list: { query: record("permissions.list") } },
      organizations: {
        get: { query: record("organizations.get") },
        members: { list: { query: record("organizations.members.list") } },
      },
    },
  };
}

describe("buildPrefetchPlan", () => {
  test("returns an empty plan when activeOrgId is null", () => {
    const { client } = makeStubClient();
    for (const route of [
      "overview",
      "profiles",
      "items",
      "agents",
      "permissions",
      "audit",
      "settings",
    ] as const satisfies readonly PrefetchableRoute[]) {
      expect(buildPrefetchPlan(route, null, client)).toEqual([]);
    }
  });

  test("overview warms profiles, items, agents, permissions", () => {
    const { client } = makeStubClient();
    const plan = buildPrefetchPlan("overview", ORG_ID, client);
    expect(plan.map((e) => e.queryKey)).toEqual([
      dashboardQueryKeys.profiles(ORG_ID),
      dashboardQueryKeys.orgItems(ORG_ID),
      dashboardQueryKeys.orgAgents(ORG_ID),
      dashboardQueryKeys.orgPermissions(ORG_ID),
    ]);
  });

  test("profiles warms only the profiles list", () => {
    const { client } = makeStubClient();
    const plan = buildPrefetchPlan("profiles", ORG_ID, client);
    expect(plan.map((e) => e.queryKey)).toEqual([dashboardQueryKeys.profiles(ORG_ID)]);
  });

  test("items warms items and permissions (permissions used for badges)", () => {
    const { client } = makeStubClient();
    const plan = buildPrefetchPlan("items", ORG_ID, client);
    expect(plan.map((e) => e.queryKey)).toEqual([
      dashboardQueryKeys.orgItems(ORG_ID),
      dashboardQueryKeys.orgPermissions(ORG_ID),
    ]);
  });

  test("agents warms only the agents list", () => {
    const { client } = makeStubClient();
    const plan = buildPrefetchPlan("agents", ORG_ID, client);
    expect(plan.map((e) => e.queryKey)).toEqual([dashboardQueryKeys.orgAgents(ORG_ID)]);
  });

  test("permissions warms permissions, items, agents (filter dropdown lookups)", () => {
    const { client } = makeStubClient();
    const plan = buildPrefetchPlan("permissions", ORG_ID, client);
    expect(plan.map((e) => e.queryKey)).toEqual([
      dashboardQueryKeys.orgPermissions(ORG_ID),
      dashboardQueryKeys.orgItems(ORG_ID),
      dashboardQueryKeys.orgAgents(ORG_ID),
    ]);
  });

  test("audit warms only lookup queries — main audit list is filter-driven", () => {
    const { client } = makeStubClient();
    const plan = buildPrefetchPlan("audit", ORG_ID, client);
    expect(plan.map((e) => e.queryKey)).toEqual([
      dashboardQueryKeys.orgAgents(ORG_ID),
      dashboardQueryKeys.orgItems(ORG_ID),
    ]);
  });

  test("settings warms organization + members but NOT items (danger zone is tertiary)", () => {
    const { client } = makeStubClient();
    const plan = buildPrefetchPlan("settings", ORG_ID, client);
    expect(plan.map((e) => e.queryKey)).toEqual([
      dashboardQueryKeys.organization(ORG_ID),
      dashboardQueryKeys.orgMembers(ORG_ID),
    ]);
    // Explicit guard against regression: items must not be in settings' plan.
    const hasItems = plan.some(
      (e) => JSON.stringify(e.queryKey).includes(`"${ORG_ID}"`) && e.queryKey[0] === "items",
    );
    expect(hasItems).toBe(false);
  });

  test("each entry's queryFn dispatches to the matching client procedure", async () => {
    const { client, calls } = makeStubClient();
    const plan = buildPrefetchPlan("overview", ORG_ID, client);
    await Promise.all(plan.map((e) => e.queryFn()));

    // overview fires: profiles.list, items.list, agents.list, permissions.list
    expect(calls.map((c) => c.proc)).toEqual([
      "profiles.list",
      "items.list",
      "agents.list",
      "permissions.list",
    ]);
    // profiles.list is called with { orgId }; items/agents/permissions are
    // drained — each first page requests the max limit with no cursor.
    expect(calls[0]?.args).toEqual({ orgId: ORG_ID });
    expect(calls[1]?.args).toEqual({ cursor: undefined, limit: 100 });
    expect(calls[2]?.args).toEqual({ cursor: undefined, limit: 100 });
    expect(calls[3]?.args).toEqual({ cursor: undefined, limit: 100 });
  });

  test("a paginated entry's queryFn drains every page, not just the first", async () => {
    // items.list returns two pages; the warmed cache must hold both rows so the
    // page component (which also drains) doesn't trust a truncated first page.
    let itemsCall = 0;
    const client: PrefetchClient = {
      profiles: { list: { query: async () => ({}) } },
      items: {
        list: {
          query: async () => {
            itemsCall++;
            return itemsCall === 1
              ? { items: [{ id: "i1" }], nextCursor: "c1" }
              : { items: [{ id: "i2" }], nextCursor: null };
          },
        },
      },
      agents: { list: { query: async () => ({ agents: [], nextCursor: null }) } },
      permissions: { list: { query: async () => ({ permissions: [], nextCursor: null }) } },
      organizations: {
        get: { query: async () => ({}) },
        members: { list: { query: async () => ({}) } },
      },
    };

    const plan = buildPrefetchPlan("items", ORG_ID, client);
    const result = (await plan[0]?.queryFn()) as {
      items: { id: string }[];
      nextCursor: string | null;
    };

    expect(itemsCall).toBe(2);
    expect(result.items.map((i) => i.id)).toEqual(["i1", "i2"]);
    expect(result.nextCursor).toBeNull();
  });

  test("settings queryFns dispatch to organizations.get and organizations.members.list with orgId", async () => {
    const { client, calls } = makeStubClient();
    const plan = buildPrefetchPlan("settings", ORG_ID, client);
    await Promise.all(plan.map((e) => e.queryFn()));

    expect(calls.map((c) => c.proc)).toEqual(["organizations.get", "organizations.members.list"]);
    expect(calls[0]?.args).toEqual({ orgId: ORG_ID });
    expect(calls[1]?.args).toEqual({ orgId: ORG_ID });
  });
});

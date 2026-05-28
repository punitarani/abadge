import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { AppBindings, BaseRequestContext } from "../../context";
import { createTrpcCallerFactory } from "../../init";
import { appRouter } from "../../router";
import { seedOrg, seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";
import { TEST_ENV } from "../helpers/test-env";

const callerFactory = createTrpcCallerFactory(appRouter);

function createUnauthenticatedCaller(
  db: ReturnType<typeof getTestDb>,
  auth: ReturnType<typeof createTestAuth>,
  requestOverrides?: { headers?: Headers },
) {
  const headers = requestOverrides?.headers ?? new Headers();
  const ctx: BaseRequestContext = {
    req: new Request("http://test", { headers }),
    resHeaders: new Headers(),
    env: { ...TEST_ENV } as AppBindings,
    validatedEnv: TEST_ENV,
    db,
    auth,
    ipAddress: "127.0.0.1",
  };
  return callerFactory(ctx);
}

describe("auth chain integration", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  // -------------------------------------------------------------------------
  // 1. Valid session resolves to correct userId
  // -------------------------------------------------------------------------
  test("valid session resolves to correct userId", async () => {
    const user = await seedUser(auth);
    const org = await seedOrg(auth, user.userId);
    const caller = createOperatorCaller(db, auth, user.headers, org.orgId);

    const result = await caller.agents.list({});
    expect(result.agents).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 2. Request without session headers is rejected
  // -------------------------------------------------------------------------
  test("request without session headers is rejected", async () => {
    const caller = createUnauthenticatedCaller(db, auth);

    try {
      await caller.agents.list({});
      expect.unreachable("agents.list should have thrown for unauthenticated request");
    } catch (error: unknown) {
      const trpcError = error as { code?: string };
      expect(trpcError.code).toBe("UNAUTHORIZED");
    }
  });

  // -------------------------------------------------------------------------
  // 3. Request with invalid session cookie is rejected
  // -------------------------------------------------------------------------
  test("request with invalid session cookie is rejected", async () => {
    const headers = new Headers();
    headers.set("cookie", "better-auth.session_token=fake-session-token");

    const caller = createUnauthenticatedCaller(db, auth, { headers });

    try {
      await caller.agents.list({});
      expect.unreachable("agents.list should have thrown for fake session cookie");
    } catch (error: unknown) {
      const trpcError = error as { code?: string };
      expect(trpcError.code).toBe("UNAUTHORIZED");
    }
  });

  // -------------------------------------------------------------------------
  // 4. X-Abadge-Org-Id selects the correct organization
  // -------------------------------------------------------------------------
  test("X-Abadge-Org-Id selects the correct organization", async () => {
    const user = await seedUser(auth);
    const org1 = await seedOrg(auth, user.userId, { name: "Org One", slug: "org-one" });
    const org2 = await seedOrg(auth, user.userId, { name: "Org Two", slug: "org-two" });

    // Create an agent in org1
    const callerOrg1 = createOperatorCaller(db, auth, user.headers, org1.orgId);
    await callerOrg1.agents.create({
      name: "org1-agent",
      kind: "remote",
      authMethod: "legacy_api_key",
    });

    // List agents scoped to org2 — should be empty
    const callerOrg2 = createOperatorCaller(db, auth, user.headers, org2.orgId);
    const org2Agents = await callerOrg2.agents.list({});
    expect(org2Agents.agents).toEqual([]);

    // List agents scoped to org1 — should contain the one we created
    const org1Agents = await callerOrg1.agents.list({});
    expect(org1Agents.agents).toHaveLength(1);
    expect(org1Agents.agents[0].name).toBe("org1-agent");
  });

  // -------------------------------------------------------------------------
  // 5. Cookie-based auth works for session procedures
  // -------------------------------------------------------------------------
  test("cookie-based auth works for session procedures", async () => {
    const user = await seedUser(auth);
    const org = await seedOrg(auth, user.userId);

    // seedUser returns cookie-based headers via testUtils.login()
    const cookieHeader = user.headers.get("cookie");
    expect(cookieHeader).toBeDefined();
    expect(cookieHeader).toContain("better-auth.session_token=");

    // Cookie auth exercises auth.api.getSession() in resolveSessionIdentity
    const caller = createOperatorCaller(db, auth, user.headers, org.orgId);
    const result = await caller.agents.list({});
    expect(result.agents).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 6. Bearer token auth works as fallback for session procedures
  // -------------------------------------------------------------------------
  test("bearer token auth works as fallback for session procedures", async () => {
    const user = await seedUser(auth);
    const org = await seedOrg(auth, user.userId);

    // Build explicit Bearer headers from the raw session token
    const bearerHeaders = new Headers();
    bearerHeaders.set("authorization", `Bearer ${user.token}`);

    // Bearer auth exercises resolveBearerSessionIdentity in resolveSessionIdentity
    const caller = createOperatorCaller(db, auth, bearerHeaders, org.orgId);
    const result = await caller.agents.list({});
    expect(result.agents).toEqual([]);
  });
});

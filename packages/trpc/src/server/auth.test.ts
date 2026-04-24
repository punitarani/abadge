import { beforeEach, describe, expect, test } from "bun:test";
import { BadRequestError, ForbiddenError, UnauthorizedError } from "@abadge/core";
import { Effect } from "effect";
import {
  _resetUnauthBearerAuditCounters,
  _unauthBearerAuditMapSize,
  resolveSessionIdentity,
  resolveUserOrgId,
  shouldWriteUnauthBearerAudit,
} from "./auth";
import type { BaseRequestContext } from "./context";
import { createTrpcCallerFactory, createTrpcRouter, scopedSessionProcedure } from "./init";

function createMockDb(): BaseRequestContext["db"] {
  let callCount = 0;
  const results = [[{ organizationId: "org_mock" }], [{ role: "owner" }]];
  const mockQuery = {
    from: () => mockQuery,
    where: () => mockQuery,
    limit: () => Promise.resolve(results[callCount++] ?? []),
    orderBy: () => Promise.resolve(results[callCount++] ?? []),
  };
  return {
    select: () => mockQuery,
  } as unknown as BaseRequestContext["db"];
}

function createMockContext(headers?: HeadersInit): BaseRequestContext {
  return {
    req: new Request("http://localhost/trpc/vault.get", { headers }),
    resHeaders: new Headers(),
    env: {} as BaseRequestContext["env"],
    validatedEnv: {} as BaseRequestContext["validatedEnv"],
    db: createMockDb(),
    auth: {
      api: {
        getSession: async () => null,
      },
      $context: Promise.resolve({
        internalAdapter: {
          findSession: async () => ({
            session: { userId: "user_from_session" },
            user: null,
          }),
        },
      }),
    } as BaseRequestContext["auth"],
  };
}

describe("resolveSessionIdentity", () => {
  test("uses session.userId when getSession returns a null user", async () => {
    const ctx = createMockContext();
    ctx.auth = {
      api: {
        getSession: async () => ({
          session: { userId: "user_from_get_session" },
          user: null,
        }),
      },
      $context: Promise.resolve({
        internalAdapter: {
          findSession: async () => null,
        },
      }),
    } as BaseRequestContext["auth"];

    const identity = await Effect.runPromise(resolveSessionIdentity(ctx));

    expect(identity).toEqual({
      authMethod: "browser_session",
      kind: "session",
      userId: "user_from_get_session",
      organizationId: "org_mock",
    });
  });

  test("falls back to session.userId when the session lookup user is null", async () => {
    const identity = await Effect.runPromise(
      resolveSessionIdentity(
        createMockContext({
          Authorization: "Bearer bearer-session-token",
        }),
      ),
    );

    expect(identity).toEqual({
      authMethod: "bearer_session",
      kind: "session",
      userId: "user_from_session",
      organizationId: "org_mock",
    });
  });

  test("rejects bearer tokens that do not resolve to a user session", async () => {
    const ctx = createMockContext({
      Authorization: "Bearer abg_test_api_key",
    });
    ctx.auth = {
      api: {
        getSession: async () => null,
      },
      $context: Promise.resolve({
        internalAdapter: {
          findSession: async () => null,
        },
      }),
    } as BaseRequestContext["auth"];

    const error = await Effect.runPromise(Effect.flip(resolveSessionIdentity(ctx)));

    expect(error).toMatchObject({
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    });
  });

  test("scoped session procedures still accept browser or bearer sessions", async () => {
    const router = createTrpcRouter({
      write: scopedSessionProcedure("items:write").query(() => ({ ok: true })),
    });
    const ctx = createMockContext({
      Authorization: "Bearer bearer-session-token",
    });
    const caller = createTrpcCallerFactory(router)(ctx);
    await expect(caller.write()).resolves.toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// resolveUserOrgId
// ---------------------------------------------------------------------------

interface OrgIdResolverDbFixture {
  /** Rows returned by the header-scoped membership lookup (with `.limit(1)`). */
  headerMemberships?: Array<{ organizationId: string }>;
  /** Rows returned by the fallback membership lookup (with `.orderBy(...)`). */
  fallbackMemberships?: Array<{ organizationId: string }>;
}

/**
 * Minimal Drizzle-like select builder that returns fixed results depending on
 * whether the final terminal call was `.limit()` or `.orderBy()`. Matches the
 * two query shapes in `resolveUserOrgId`.
 */
function createOrgIdResolverDb(fixture: OrgIdResolverDbFixture): BaseRequestContext["db"] {
  const builder = {
    from() {
      return this;
    },
    where() {
      return this;
    },
    limit() {
      return Promise.resolve(fixture.headerMemberships ?? []);
    },
    orderBy() {
      return Promise.resolve(fixture.fallbackMemberships ?? []);
    },
  };
  return {
    select: () => builder,
  } as unknown as BaseRequestContext["db"];
}

function createOrgIdResolverContext(
  fixture: OrgIdResolverDbFixture,
  headers?: HeadersInit,
): BaseRequestContext {
  return {
    req: new Request("http://localhost/trpc/any", { headers }),
    resHeaders: new Headers(),
    env: {} as BaseRequestContext["env"],
    validatedEnv: {} as BaseRequestContext["validatedEnv"],
    db: createOrgIdResolverDb(fixture),
    auth: {
      api: {
        getSession: async () => null,
      },
      $context: Promise.resolve({
        internalAdapter: { findSession: async () => null },
      }),
    } as BaseRequestContext["auth"],
  };
}

describe("resolveUserOrgId", () => {
  test("header + valid membership returns the requested org", async () => {
    const ctx = createOrgIdResolverContext(
      { headerMemberships: [{ organizationId: "org_requested" }] },
      { "X-Abadge-Org-Id": "org_requested" },
    );
    await expect(resolveUserOrgId(ctx, "user_1")).resolves.toBe("org_requested");
  });

  test("header + no membership rejects with ORG_MEMBERSHIP_REQUIRED", async () => {
    const ctx = createOrgIdResolverContext(
      { headerMemberships: [] },
      { "X-Abadge-Org-Id": "org_not_mine" },
    );
    try {
      await resolveUserOrgId(ctx, "user_1");
      expect.unreachable("expected resolveUserOrgId to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenError);
      expect(err).toMatchObject({
        code: "ORG_MEMBERSHIP_REQUIRED",
        message: "Not a member of the requested organization",
      });
    }
  });

  test("no header + 0 memberships rejects with NO_ORG_MEMBERSHIP", async () => {
    const ctx = createOrgIdResolverContext({ fallbackMemberships: [] });
    try {
      await resolveUserOrgId(ctx, "user_orphan");
      expect.unreachable("expected resolveUserOrgId to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(UnauthorizedError);
      expect(err).toMatchObject({
        code: "NO_ORG_MEMBERSHIP",
        message: "User has no organization membership",
      });
    }
  });

  test("no header + exactly 1 membership returns that orgId", async () => {
    const ctx = createOrgIdResolverContext({
      fallbackMemberships: [{ organizationId: "org_solo" }],
    });
    await expect(resolveUserOrgId(ctx, "user_solo")).resolves.toBe("org_solo");
  });

  test("no header + 2+ memberships rejects with ORG_HEADER_REQUIRED and lists orgIds", async () => {
    const ctx = createOrgIdResolverContext({
      fallbackMemberships: [{ organizationId: "org_a" }, { organizationId: "org_b" }],
    });
    try {
      await resolveUserOrgId(ctx, "user_multi");
      expect.unreachable("expected resolveUserOrgId to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestError);
      expect(err).toMatchObject({
        code: "ORG_HEADER_REQUIRED",
        message: "X-Abadge-Org-Id header required for multi-org users",
      });
      const meta = (err as BadRequestError).meta as { availableOrgIds: string[] } | undefined;
      expect(meta?.availableOrgIds).toEqual(expect.arrayContaining(["org_a", "org_b"]));
      expect(meta?.availableOrgIds).toHaveLength(2);
    }
  });
});

// ---------------------------------------------------------------------------
// shouldWriteUnauthBearerAudit map bounding (Issue 5)
// ---------------------------------------------------------------------------

describe("shouldWriteUnauthBearerAudit map bounding", () => {
  beforeEach(() => _resetUnauthBearerAuditCounters());

  test("first call for an IP returns true", () => {
    expect(shouldWriteUnauthBearerAudit("1.2.3.4")).toBe(true);
  });

  test("second call for same IP within window returns false", () => {
    shouldWriteUnauthBearerAudit("1.2.3.4");
    expect(shouldWriteUnauthBearerAudit("1.2.3.4")).toBe(false);
  });

  test("undefined IP is deduplicated as a single bucket", () => {
    expect(shouldWriteUnauthBearerAudit(undefined)).toBe(true);
    expect(shouldWriteUnauthBearerAudit(undefined)).toBe(false);
  });

  test("map size stays bounded under scattered-source pressure", () => {
    // Simulate probes from many unique IPs — map must not reach 15k entries.
    for (let i = 0; i < 15_000; i++) {
      shouldWriteUnauthBearerAudit(`10.${Math.floor(i / 65536) % 256}.${Math.floor(i / 256) % 256}.${i % 256}`);
    }
    // After the hard cap fires and clears the map, new entries accumulate.
    // The invariant is that the map never held 15k entries simultaneously.
    expect(_unauthBearerAuditMapSize()).toBeLessThan(15_000);
  });
});

import { describe, expect, test } from "bun:test";
import { UnauthorizedError } from "@abadge/core";
import { Effect } from "effect";
import { resolveSessionIdentityOptionalOrg } from "./auth-optional-org";
import type { BaseRequestContext } from "./context";

interface OptionalOrgDbFixture {
  /** Rows returned by the header-scoped membership lookup (with `.limit(1)`). */
  headerMemberships?: Array<{ organizationId: string }>;
  /** Rows returned by the fallback membership lookup (with `.orderBy(...)`). */
  fallbackMemberships?: Array<{ organizationId: string }>;
}

/**
 * Minimal Drizzle-like select builder that returns fixed results depending on
 * whether the final terminal call was `.limit()` or `.orderBy()`. Matches the
 * two query shapes in `resolveOptionalOrgId`.
 */
function createOptionalOrgDb(fixture: OptionalOrgDbFixture): BaseRequestContext["db"] {
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

function createOptionalOrgContext(
  fixture: OptionalOrgDbFixture,
  headers?: HeadersInit,
): BaseRequestContext {
  return {
    req: new Request("http://localhost/trpc/organizations.list", { headers }),
    resHeaders: new Headers(),
    env: {} as BaseRequestContext["env"],
    validatedEnv: {} as BaseRequestContext["validatedEnv"],
    db: createOptionalOrgDb(fixture),
    auth: {
      api: {
        // Default: no session. Individual tests override this.
        getSession: async () => null,
      },
      $context: Promise.resolve({
        internalAdapter: { findSession: async () => null },
      }),
    } as BaseRequestContext["auth"],
  };
}

describe("resolveSessionIdentityOptionalOrg", () => {
  test("zero memberships → organizationId is null", async () => {
    const ctx = createOptionalOrgContext({ fallbackMemberships: [] });
    ctx.auth = {
      api: {
        getSession: async () => ({
          session: { userId: "user_new" },
          user: { id: "user_new" },
        }),
      },
      $context: Promise.resolve({
        internalAdapter: { findSession: async () => null },
      }),
    } as BaseRequestContext["auth"];

    const identity = await Effect.runPromise(resolveSessionIdentityOptionalOrg(ctx));

    expect(identity).toEqual({
      kind: "session",
      userId: "user_new",
      organizationId: null,
      authMethod: "browser_session",
    });
  });

  test("single membership → resolves to that organizationId", async () => {
    const ctx = createOptionalOrgContext({
      fallbackMemberships: [{ organizationId: "org_only" }],
    });
    ctx.auth = {
      api: {
        getSession: async () => ({
          session: { userId: "user_solo" },
          user: { id: "user_solo" },
        }),
      },
      $context: Promise.resolve({
        internalAdapter: { findSession: async () => null },
      }),
    } as BaseRequestContext["auth"];

    const identity = await Effect.runPromise(resolveSessionIdentityOptionalOrg(ctx));

    expect(identity).toEqual({
      kind: "session",
      userId: "user_solo",
      organizationId: "org_only",
      authMethod: "browser_session",
    });
  });

  test("2+ memberships without header → organizationId is null (no longer throws)", async () => {
    const ctx = createOptionalOrgContext({
      fallbackMemberships: [{ organizationId: "org_a" }, { organizationId: "org_b" }],
    });
    ctx.auth = {
      api: {
        getSession: async () => ({
          session: { userId: "user_multi" },
          user: { id: "user_multi" },
        }),
      },
      $context: Promise.resolve({
        internalAdapter: { findSession: async () => null },
      }),
    } as BaseRequestContext["auth"];

    // §ORG2 fix: multi-org users without a header get null org context instead
    // of ORG_HEADER_REQUIRED. Bootstrap-safe routes (userProcedure) handle null.
    const identity = await Effect.runPromise(resolveSessionIdentityOptionalOrg(ctx));

    expect(identity).toEqual({
      kind: "session",
      userId: "user_multi",
      organizationId: null,
      authMethod: "browser_session",
    });
  });

  test("no session → rejects with UNAUTHORIZED", async () => {
    // ctx.auth.api.getSession already returns null by default
    const ctx = createOptionalOrgContext({ fallbackMemberships: [] });

    const error = await Effect.runPromise(Effect.flip(resolveSessionIdentityOptionalOrg(ctx)));

    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(error).toMatchObject({
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    });
  });

  test("X-Abadge-Org-Id present and valid → returns header value", async () => {
    const ctx = createOptionalOrgContext(
      { headerMemberships: [{ organizationId: "org_requested" }] },
      { "X-Abadge-Org-Id": "org_requested" },
    );
    ctx.auth = {
      api: {
        getSession: async () => ({
          session: { userId: "user_header" },
          user: { id: "user_header" },
        }),
      },
      $context: Promise.resolve({
        internalAdapter: { findSession: async () => null },
      }),
    } as BaseRequestContext["auth"];

    const identity = await Effect.runPromise(resolveSessionIdentityOptionalOrg(ctx));

    expect(identity).toEqual({
      kind: "session",
      userId: "user_header",
      organizationId: "org_requested",
      authMethod: "browser_session",
    });
  });

  // A foreign/stale X-Abadge-Org-Id (e.g. an `activeOrgId` persisted in the
  // browser from a previous account) must NOT be fatal on bootstrap-safe
  // routes. Before the fix this threw ORG_MEMBERSHIP_REQUIRED, which broke
  // organizations.list/create/createPersonal and stranded fresh/switched users
  // on the dashboard error card. It now falls through to membership resolution,
  // exactly as if no header were sent.
  test("X-Abadge-Org-Id present but user is not a member → falls through (null when no memberships)", async () => {
    const ctx = createOptionalOrgContext(
      { headerMemberships: [], fallbackMemberships: [] },
      { "X-Abadge-Org-Id": "org_not_mine" },
    );
    ctx.auth = {
      api: {
        getSession: async () => ({
          session: { userId: "user_foreign" },
          user: { id: "user_foreign" },
        }),
      },
      $context: Promise.resolve({
        internalAdapter: { findSession: async () => null },
      }),
    } as BaseRequestContext["auth"];

    const identity = await Effect.runPromise(resolveSessionIdentityOptionalOrg(ctx));

    expect(identity).toEqual({
      kind: "session",
      userId: "user_foreign",
      organizationId: null,
      authMethod: "browser_session",
    });
  });

  test("X-Abadge-Org-Id foreign but user has one real membership → resolves to that membership", async () => {
    const ctx = createOptionalOrgContext(
      { headerMemberships: [], fallbackMemberships: [{ organizationId: "org_real" }] },
      { "X-Abadge-Org-Id": "org_stale" },
    );
    ctx.auth = {
      api: {
        getSession: async () => ({
          session: { userId: "user_switched" },
          user: { id: "user_switched" },
        }),
      },
      $context: Promise.resolve({
        internalAdapter: { findSession: async () => null },
      }),
    } as BaseRequestContext["auth"];

    const identity = await Effect.runPromise(resolveSessionIdentityOptionalOrg(ctx));

    expect(identity).toEqual({
      kind: "session",
      userId: "user_switched",
      organizationId: "org_real",
      authMethod: "browser_session",
    });
  });
});

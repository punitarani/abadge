import { describe, expect, test } from "bun:test";
import { BadRequestError, UnauthorizedError } from "@abadge/core";
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

  test("2+ memberships without header → rejects with ORG_HEADER_REQUIRED", async () => {
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

    const error = await Effect.runPromise(
      Effect.flip(resolveSessionIdentityOptionalOrg(ctx)),
    );

    expect(error).toBeInstanceOf(BadRequestError);
    expect(error).toMatchObject({
      code: "ORG_HEADER_REQUIRED",
      message: "X-Abadge-Org-Id header required for multi-org users",
    });
    const meta = (error as BadRequestError).meta as { availableOrgIds: string[] } | undefined;
    expect(meta?.availableOrgIds).toEqual(expect.arrayContaining(["org_a", "org_b"]));
    expect(meta?.availableOrgIds).toHaveLength(2);
  });

  test("no session → rejects with UNAUTHORIZED", async () => {
    // ctx.auth.api.getSession already returns null by default
    const ctx = createOptionalOrgContext({ fallbackMemberships: [] });

    const error = await Effect.runPromise(
      Effect.flip(resolveSessionIdentityOptionalOrg(ctx)),
    );

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

  test("X-Abadge-Org-Id present but user is not a member → throws ORG_MEMBERSHIP_REQUIRED", async () => {
    const ctx = createOptionalOrgContext(
      { headerMemberships: [] },
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

    const error = await Effect.runPromise(
      Effect.flip(resolveSessionIdentityOptionalOrg(ctx)),
    );

    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(error).toMatchObject({
      code: "ORG_MEMBERSHIP_REQUIRED",
    });
  });
});

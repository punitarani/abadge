import { orgPluginAcOptions } from "@abadge/auth";
import type { Database } from "@abadge/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, organization, testUtils } from "better-auth/plugins";
import { TEST_ENV } from "./test-env";

/**
 * Mirrors the TestHelpers interface from better-auth/plugins/test-utils.
 * Organization helpers are optional in the type but always present when
 * the organization plugin is loaded alongside testUtils.
 */
interface TestHelpers {
  createUser(overrides?: Record<string, unknown>): Record<string, unknown>;
  createOrganization?(overrides?: Record<string, unknown>): Record<string, unknown>;
  saveUser(user: Record<string, unknown>): Promise<Record<string, unknown>>;
  saveOrganization?(org: Record<string, unknown>): Promise<Record<string, unknown>>;
  addMember?(opts: {
    userId: string;
    organizationId: string;
    role?: string;
  }): Promise<Record<string, unknown>>;
  deleteUser(userId: string): Promise<void>;
  deleteOrganization?(orgId: string): Promise<void>;
  login(opts: { userId: string }): Promise<{
    session: Record<string, unknown>;
    user: Record<string, unknown>;
    headers: Headers;
    cookies: unknown[];
    token: string;
  }>;
  getAuthHeaders(opts: { userId: string }): Promise<Headers>;
  getCookies(opts: { userId: string; domain?: string }): Promise<unknown[]>;
  getOTP?(identifier: string): string | undefined;
  clearOTPs?(): void;
}

/**
 * Creates a Better Auth instance wired to the test Postgres database.
 * Mirrors the production config in packages/auth/src/server.ts but omits
 * social providers, device authorization, and openAPI (not needed for tests).
 * Includes testUtils plugin for factory-based test seeding.
 */
// `opts.cookieCacheMaxAgeSeconds` is opt-in: production enables session
// cookieCache, but most integration tests assert immediate session revocation
// and pass headers without the `session_data` cookie, so the default mirrors a
// no-cache config and stays zero-blast-radius. The cookieCache lock test opts in.
// biome-ignore lint/suspicious/noExplicitAny: Better Auth inferred type is too complex for TS to serialize
export function createTestAuth(db: Database, opts?: { cookieCacheMaxAgeSeconds?: number }): any {
  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg" }),
    baseURL: TEST_ENV.ABADGE_API_URL,
    secret: TEST_ENV.BETTER_AUTH_SECRET,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      ...(opts?.cookieCacheMaxAgeSeconds !== undefined
        ? { cookieCache: { enabled: true, maxAge: opts.cookieCacheMaxAgeSeconds } }
        : {}),
    },
    plugins: [
      organization({
        allowUserToCreateOrganization: true,
        creatorRole: "owner",
        ...orgPluginAcOptions,
      }),
      bearer(),
      testUtils(),
    ],
  });
}

export type TestAuth = ReturnType<typeof createTestAuth>;

/**
 * Typed accessor for testUtils helpers from the auth context.
 * Organization helpers (saveOrganization, addMember, etc.) are asserted
 * as present because our test auth config always includes the organization plugin.
 */
export async function getTestHelpers(auth: TestAuth): Promise<Required<TestHelpers>> {
  const ctx = await auth.$context;
  return ctx.test as Required<TestHelpers>;
}

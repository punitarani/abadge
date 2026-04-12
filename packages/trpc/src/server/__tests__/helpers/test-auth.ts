import type { Database } from "@abadge/db";
import { apiKey } from "@better-auth/api-key";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, organization } from "better-auth/plugins";
import { TEST_ENV } from "./test-env";

/**
 * Creates a Better Auth instance wired to the test Postgres database.
 * Mirrors the production config in packages/auth/src/server.ts but omits
 * social providers, device authorization, and openAPI (not needed for tests).
 */
export function createTestAuth(db: Database) {
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
    },
    plugins: [
      organization({
        allowUserToCreateOrganization: true,
        creatorRole: "owner",
      }),
      bearer(),
      apiKey(),
    ],
  });
}

// biome-ignore lint/suspicious/noExplicitAny: Better Auth inferred type is too complex for TS to serialize
export type TestAuth = ReturnType<typeof createTestAuth> & { api: any };

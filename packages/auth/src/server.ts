import type { Database } from "@abadge/db";
import { apiKey } from "@better-auth/api-key";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { openAPI, organization } from "better-auth/plugins";

export interface AuthEnv {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
}

// biome-ignore lint/suspicious/noExplicitAny: Better Auth inferred type is too complex for TS to serialize
export function createAuth(db: Database, env: AuthEnv): any {
  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg" }),
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    trustedOrigins: ["http://localhost:3000"],
    plugins: [
      organization({
        allowUserToCreateOrganization: true,
        creatorRole: "owner",
      }),
      apiKey({
        defaultPrefix: "abd_",
        enableMetadata: true,
        rateLimit: {
          enabled: true,
          timeWindow: 1000 * 60 * 60,
          maxRequests: 1000,
        },
      }),
      openAPI(),
    ],
  });
}

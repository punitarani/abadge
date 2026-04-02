import type { Database } from "@abadge/db";
import { apiKey } from "@better-auth/api-key";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { openAPI, organization } from "better-auth/plugins";

export interface AuthEnv {
  ABADGE_API_URL: string;
  ABADGE_APP_URL: string;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
}

type AuthOriginsEnv = Partial<Pick<AuthEnv, "ABADGE_API_URL" | "ABADGE_APP_URL">> & {
  API_URL?: string;
  APP_URL?: string;
};

export function getTrustedOrigins(env: AuthOriginsEnv): string[] {
  const apiUrl = env.ABADGE_API_URL ?? env.API_URL;
  const appUrl = env.ABADGE_APP_URL ?? env.APP_URL;

  return [apiUrl, appUrl, "http://localhost:3000", "http://localhost:3001"].filter(
    (origin): origin is string => typeof origin === "string" && origin.length > 0,
  );
}

// biome-ignore lint/suspicious/noExplicitAny: Better Auth inferred type is too complex for TS to serialize
export function createAuth(db: Database, env: AuthEnv): any {
  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg" }),
    baseURL: env.ABADGE_API_URL,
    secret: env.BETTER_AUTH_SECRET,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    socialProviders: {
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
        : {}),
      ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
        ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } }
        : {}),
    },
    trustedOrigins: getTrustedOrigins(env),
    plugins: [
      organization({
        allowUserToCreateOrganization: true,
        creatorRole: "owner",
      }),
      openAPI(),
      apiKey(),
    ],
  });
}

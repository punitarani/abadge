import type { Database } from "@abadge/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { openAPI, organization } from "better-auth/plugins";

type SocialProvider = "github" | "google";

export interface AuthEnv {
  API_URL: string;
  APP_URL: string;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
}

export function getTrustedOrigins(env: Pick<AuthEnv, "API_URL" | "APP_URL">): string[] {
  return [env.API_URL, env.APP_URL, "http://localhost:3000", "http://localhost:3001"];
}

export function getEnabledSocialProviders(env: AuthEnv): SocialProvider[] {
  const providers: SocialProvider[] = [];

  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    providers.push("github");
  }

  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.push("google");
  }

  return providers;
}

// biome-ignore lint/suspicious/noExplicitAny: Better Auth inferred type is too complex for TS to serialize
export function createAuth(db: Database, env: AuthEnv): any {
  const plugins = [
    organization({
      allowUserToCreateOrganization: true,
      creatorRole: "owner",
    }),
    openAPI(),
  ] as unknown as NonNullable<Parameters<typeof betterAuth>[0]["plugins"]>;

  const socialProviders = {} as NonNullable<Parameters<typeof betterAuth>[0]["socialProviders"]>;

  const enabledProviders = getEnabledSocialProviders(env);

  if (enabledProviders.includes("google") && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    };
  }

  if (enabledProviders.includes("github") && env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    socialProviders.github = {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    };
  }

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
    socialProviders: Object.keys(socialProviders).length > 0 ? socialProviders : undefined,
    trustedOrigins: getTrustedOrigins(env),
    plugins,
  });
}

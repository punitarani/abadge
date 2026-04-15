import type { Database } from "@abadge/db";
import { auditLogs } from "@abadge/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, deviceAuthorization, openAPI, organization } from "better-auth/plugins";
import { buildOrgCreateAuditRow, buildOrgDeleteAuditRow } from "./audit-hooks";

export interface AuthEnv {
  ABADGE_API_URL: string;
  ABADGE_APP_URL: string;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
}

type AuthOriginsEnv = Partial<Pick<AuthEnv, "ABADGE_API_URL" | "ABADGE_APP_URL">> & {
  API_URL?: string;
  APP_URL?: string;
};

export function getTrustedOrigins(env: AuthOriginsEnv): string[] {
  const apiUrl = env.ABADGE_API_URL ?? env.API_URL;
  const appUrl = env.ABADGE_APP_URL ?? env.APP_URL;
  const origins = [apiUrl, appUrl].filter(
    (origin): origin is string => typeof origin === "string" && origin.length > 0,
  );
  const isDev = origins.some((o) => o.startsWith("http://localhost"));
  if (isDev) {
    origins.push("http://localhost:3000", "http://localhost:3001");
  }
  return [...new Set(origins)];
}

export const DEVICE_AUTH_CLIENT_ID = "abadge-cli";

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
      google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
      github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET },
    },
    trustedOrigins: getTrustedOrigins(env),
    databaseHooks: {
      session: {
        create: {
          // Web logins also trigger recordLogin (surface: "api") via tRPC.
          // This hook captures CLI device-code and OAuth logins that bypass tRPC.
          // Duplicates are distinguishable via the surface field.
          after: async (session) => {
            const activeOrgId = session.activeOrganizationId;
            if (typeof activeOrgId !== "string") return;

            try {
              await db.insert(auditLogs).values({
                organizationId: activeOrgId,
                userId: session.userId,
                eventType: "auth.login",
                result: "allowed",
                ipAddress: session.ipAddress ?? null,
                surface: "auth",
                meta: {},
              });
            } catch {
              // Audit writes must not break authentication
            }
          },
        },
      },
    },
    plugins: [
      organization({
        allowUserToCreateOrganization: true,
        creatorRole: "owner",
        organizationHooks: {
          // The tRPC organizations.create handler writes its own audit row with
          // surface: "api". This hook fires on every org creation through the
          // Better Auth plugin route /api/auth/organization/create (used by the
          // CLI device-code flow and any caller that bypasses tRPC). Tagging
          // with surface: "auth" distinguishes the two rows — mirrors the
          // session.create hook pattern above.
          afterCreateOrganization: async ({ organization, user }) => {
            try {
              await db.insert(auditLogs).values(buildOrgCreateAuditRow({ organization, user }));
            } catch {
              // Audit writes must not break organization creation
            }
          },
          afterDeleteOrganization: async ({ organization, user }) => {
            try {
              await db.insert(auditLogs).values(buildOrgDeleteAuditRow({ organization, user }));
            } catch {
              // Audit writes must not break organization deletion
            }
          },
        },
      }),
      openAPI(),
      bearer(),
      deviceAuthorization({
        verificationUri: `${env.ABADGE_APP_URL.replace(/\/$/, "")}/device`,
        validateClient: async (clientId) => clientId === DEVICE_AUTH_CLIENT_ID,
      }),
    ],
  });
}

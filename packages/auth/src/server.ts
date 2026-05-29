import { type Database, onMemberRemoved, sql } from "@abadge/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, deviceAuthorization, openAPI, organization } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import {
  buildInviteAcceptAuditRow,
  buildInviteCancelAuditRow,
  buildInviteCreateAuditRow,
  buildInviteRejectAuditRow,
  buildMemberAddAuditRow,
  buildMemberRemoveAuditRow,
  buildMemberRoleUpdateAuditRow,
  buildOrgCreateAuditRow,
  buildOrgDeleteAuditRow,
  buildOrgUpdateAuditRow,
  safeAuditInsert,
} from "./audit-hooks";
import { type CloudflareEmailBinding, sendEmail } from "./mailer";
import { buildEmailVerificationUrl } from "./verification-url";

// Custom access-control for the organization plugin.
// Admin loses member:"update" so the Better Auth HTTP endpoint
// /api/auth/organization/update-member-role rejects admin callers.
// All role mutations must go through abadge's tRPC updateMemberRole
// (owner-only, guarded by assertOwnersRemainAfterChange).
const _orgAc = createAccessControl({
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],
} as const);

/**
 * Shared organization plugin access-control options.
 * Use by spreading into `organization({...})` in both production and test auth.
 * Typed as `{ ac: any; roles: any }` to avoid cross-package type incompatibility:
 * bun may resolve different `better-auth` cache entries for each workspace
 * package, causing the concrete AccessControl/Role types to be structurally
 * incompatible across the package boundary even at the same semver.
 */
// biome-ignore lint/suspicious/noExplicitAny: Better Auth AccessControl type is not portable across package boundaries
export const orgPluginAcOptions: { ac: any; roles: any } = {
  // biome-ignore lint/suspicious/noExplicitAny: see above
  ac: _orgAc as any,
  roles: {
    admin: _orgAc.newRole({
      organization: ["update"],
      invitation: ["create", "cancel"],
      member: ["create", "delete"], // NO "update" — blocks role promotion via Better Auth plugin route
      team: ["create", "update", "delete"],
      ac: ["create", "read", "update", "delete"],
    }),
    owner: _orgAc.newRole({
      organization: ["update", "delete"],
      member: ["create", "update", "delete"],
      invitation: ["create", "cancel"],
      team: ["create", "update", "delete"],
      ac: ["create", "read", "update", "delete"],
    }),
    member: _orgAc.newRole({
      organization: [],
      member: [],
      invitation: [],
      team: [],
      ac: ["read"],
    }),
  },
};

export interface AuthEnv {
  ABADGE_API_URL: string;
  ABADGE_APP_URL: string;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  /** Cloudflare Email Workers send_email binding. */
  SEND_EMAIL: CloudflareEmailBinding;
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
      // §AU1: block sign-in until email is verified; also defends against B36
      // OAuth pre-claim by ensuring unverified email accounts cannot be used
      // to silently absorb incoming OAuth logins.
      requireEmailVerification: true,
      sendResetPassword: async ({ user, token }) => {
        await sendEmail(env, {
          to: user.email,
          subject: "Reset your abadge password",
          text: `Reset your password:\n\n${env.ABADGE_APP_URL.replace(/\/$/, "")}/reset-password/${token}\n\nThis link expires in 1 hour.`,
          html: `<p>Reset your password:</p><p><a href="${env.ABADGE_APP_URL.replace(/\/$/, "")}/reset-password/${token}">${env.ABADGE_APP_URL.replace(/\/$/, "")}/reset-password/${token}</a></p><p>This link expires in 1 hour.</p>`,
        });
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        // Point the post-verification redirect at the web app, not the API
        // origin Better Auth defaults to (which 404s). See buildEmailVerificationUrl.
        const verifyUrl = buildEmailVerificationUrl(url, env.ABADGE_APP_URL);
        await sendEmail(env, {
          to: user.email,
          subject: "Verify your abadge email",
          text: `Confirm your email address:\n\n${verifyUrl}`,
          html: `<p>Confirm your email address:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`,
        });
      },
    },
    account: {
      // B36: block OAuth pre-claim takeover. With disableImplicitLinking: true,
      // Better Auth will not silently link an incoming OAuth login to a
      // pre-existing credential account that shares the same email. Users must
      // explicitly call linkSocial() while authenticated to merge accounts.
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        trustedProviders: [],
      },
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
            await safeAuditInsert(db, {
              organizationId: activeOrgId,
              userId: session.userId,
              eventType: "auth.login",
              result: "allowed",
              ipAddress: session.ipAddress ?? null,
              surface: "auth",
              meta: {},
            });
          },
        },
      },
    },
    plugins: [
      organization({
        allowUserToCreateOrganization: true,
        creatorRole: "owner",
        ...orgPluginAcOptions,
        organizationHooks: {
          // The tRPC organizations.create handler writes its own audit row with
          // surface: "api". This hook fires on every org creation through the
          // Better Auth plugin route /api/auth/organization/create (used by the
          // CLI device-code flow and any caller that bypasses tRPC). Tagging
          // with surface: "auth" distinguishes the two rows — mirrors the
          // session.create hook pattern above.
          afterCreateOrganization: async ({ organization, user }) => {
            await safeAuditInsert(db, buildOrgCreateAuditRow({ organization, user }));
          },
          afterDeleteOrganization: async ({ organization, user }) => {
            await safeAuditInsert(db, buildOrgDeleteAuditRow({ organization, user }));
          },
          afterUpdateOrganization: async ({ organization, user, member }) => {
            // `organization` may be null when the adapter doesn't return the row.
            // Fall back to the member's organizationId for the audit record.
            await safeAuditInsert(
              db,
              buildOrgUpdateAuditRow({
                organization,
                orgId: member.organizationId,
                user,
              }),
            );
          },
          afterAddMember: async ({ member, user, organization }) => {
            await safeAuditInsert(
              db,
              buildMemberAddAuditRow({
                organization,
                member: { userId: member.userId, role: member.role },
                user,
              }),
            );
          },
          afterRemoveMember: async ({ member, user, organization }) => {
            // Audit first, then cascade. Both use safeAuditInsert / try-catch so
            // a failure in either doesn't reject the HTTP response.
            //
            // Note: Better Auth's hook passes `user` = the REMOVED user, not the
            // caller. So removedBy and removedUserId are the same value here.
            // This is a limitation of the hook contract.
            await safeAuditInsert(
              db,
              buildMemberRemoveAuditRow({
                organization,
                member,
                user,
              }),
            );

            // Run the full cascade (revoke agents, sessions, grants) so the
            // plugin path is consistent with the tRPC removeMember path.
            // §AB-0011 — set the org GUC first: onMemberRemoved deletes the
            // removed member's `permissions` rows (an RLS table), which would
            // affect zero rows under the NOBYPASSRLS runtime role without it.
            try {
              await db.transaction(async (tx) => {
                await tx.execute(
                  sql`select set_config('app.current_org', ${organization.id}, true)`,
                );
                return onMemberRemoved(tx, organization.id, member.userId, user.id);
              });
            } catch (err) {
              console.warn(
                `auth_hook_cascade_failed org=${organization.id} removedUser=${member.userId} err=${err instanceof Error ? err.message : String(err)}`,
              );
            }
          },
          afterUpdateMemberRole: async ({ member, previousRole, user, organization }) => {
            await safeAuditInsert(
              db,
              buildMemberRoleUpdateAuditRow({
                organization,
                member: { userId: member.userId, role: member.role },
                previousRole,
                user,
              }),
            );
          },
          afterCreateInvitation: async ({ invitation, inviter, organization }) => {
            await safeAuditInsert(
              db,
              buildInviteCreateAuditRow({
                invitation,
                organization,
                inviter,
              }),
            );
          },
          afterAcceptInvitation: async ({ invitation, user, organization }) => {
            await safeAuditInsert(
              db,
              buildInviteAcceptAuditRow({
                invitation,
                organization,
                user,
              }),
            );
          },
          afterRejectInvitation: async ({ invitation, user, organization }) => {
            await safeAuditInsert(
              db,
              buildInviteRejectAuditRow({
                invitation,
                organization,
                user,
              }),
            );
          },
          afterCancelInvitation: async ({ invitation, cancelledBy, organization }) => {
            await safeAuditInsert(
              db,
              buildInviteCancelAuditRow({
                invitation,
                organization,
                cancelledBy,
              }),
            );
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

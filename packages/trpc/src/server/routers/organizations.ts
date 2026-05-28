import { seedOrgWithOwnerProfile } from "@abadge/auth";
import {
  ConflictError,
  ForbiddenError,
  INVITE_TOKEN_PREFIX,
  INVITE_TOKEN_TTL_MS,
  isPersonalOrg,
  NotFoundError,
  PERSONAL_ORG_METADATA,
  RateLimitError,
  SuccessResultSchema,
} from "@abadge/core";
import { generateOpaqueToken, hashApiKey } from "@abadge/crypto/shared";
import { and, asc, eq, isNotNull, isNull, or, sql } from "@abadge/db";
import {
  auditLogs,
  invitation,
  items,
  member,
  organization,
  profiles,
  user,
} from "@abadge/db/schema";
import { Effect, Schema } from "effect";
import { logSessionAudit, logUserAudit } from "../audit";
import { assertCanAssignRole, assertOwnersRemainAfterChange } from "../auth/owner-guards";
import { onMemberRemoved } from "../cascades";
import {
  isUniqueViolation,
  runSessionEffect,
  runUserEffect,
  SessionRequestContextTag,
  strictSchema,
  tryAsync,
  UserRequestContextTag,
} from "../effect";
import { createTrpcRouter, requireOrgRole, sessionProcedure, userProcedure } from "../init";

const OrgIdSchema = Schema.Struct({
  orgId: Schema.String.pipe(Schema.minLength(1)),
});

const CreateOrganizationSchema = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(255)),
  slug: Schema.optional(
    Schema.String.pipe(
      Schema.minLength(1),
      Schema.maxLength(48),
      Schema.pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    ),
  ),
  logo: Schema.optional(Schema.String),
});

const UpdateOrganizationSchema = Schema.Struct({
  orgId: Schema.String.pipe(Schema.minLength(1)),
  name: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(255))),
  logo: Schema.optional(Schema.String),
});

const CreateInviteSchema = Schema.Struct({
  orgId: Schema.String.pipe(Schema.minLength(1)),
  role: Schema.optional(Schema.Literal("owner", "admin", "member")),
});

const RemoveMemberSchema = Schema.Struct({
  orgId: Schema.String.pipe(Schema.minLength(1)),
  memberId: Schema.String.pipe(Schema.minLength(1)),
});

const UpdateMemberRoleSchema = Schema.Struct({
  orgId: Schema.String.pipe(Schema.minLength(1)),
  memberId: Schema.String.pipe(Schema.minLength(1)),
  role: Schema.Literal("owner", "admin", "member"),
});

const CheckSlugSchema = Schema.Struct({
  slug: Schema.String.pipe(
    Schema.minLength(1),
    Schema.maxLength(48),
    Schema.pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  ),
});

const CheckSlugResultSchema = Schema.Struct({
  available: Schema.Boolean,
});

const OrgDataSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  logo: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  // True iff this org is a personal (single-user) workspace, flagged via
  // organization.metadata. The UI presents personal orgs as a personal
  // account rather than an organization.
  isPersonal: Schema.Boolean,
});

const OrgListItemSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  logo: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  role: Schema.String,
  // True iff at least one profile in this org is bootstrapped (server_managed
  // is always bootstrapped; zero_knowledge requires wrappedRootKey to be set).
  // Used by onboarding to detect orgs the user abandoned mid-flow without
  // requiring an N+1 profiles.list call per org.
  hasBootstrappedProfile: Schema.Boolean,
  // True iff this org is a personal workspace (see OrgDataSchema.isPersonal).
  isPersonal: Schema.Boolean,
});

const DefaultProfileDataSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  externalId: Schema.NullOr(Schema.String),
  storageMode: Schema.Literal("server_managed", "zero_knowledge"),
  keyVersion: Schema.Int,
});

// §REVAMP-PR3 (Task 5.1) — `organizations.create` now seeds a default
// `server_managed` profile in the same transaction. The response shape
// returns both so the client can route straight to the dashboard without a
// follow-up `profiles.create` round trip and without a "profile setup"
// step. The onboarding gate is dropped in the next commit; until then,
// auto-seeding is the only way an org is immediately usable after create.
const CreateOrgResultSchema = Schema.Struct({
  organization: OrgDataSchema,
  defaultProfile: DefaultProfileDataSchema,
});

const OrgResultSchema = Schema.Struct({
  organization: OrgDataSchema,
});

const OrgListResultSchema = Schema.Struct({
  organizations: Schema.Array(OrgListItemSchema),
});

// `email` is nullable: only owners/admins see teammates' email addresses.
// Plain members receive `email: null` to avoid enumerating org-internal
// contact info. See listMembers below.
const MemberDataSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  name: Schema.String,
  email: Schema.NullOr(Schema.String),
  role: Schema.String,
  createdAt: Schema.String,
});

const MemberListResultSchema = Schema.Struct({
  members: Schema.Array(MemberDataSchema),
});

const CreateInviteResultSchema = Schema.Struct({
  ok: Schema.Boolean,
  invitationId: Schema.String,
  token: Schema.String,
});

const InviteTokenSchema = Schema.Struct({
  token: Schema.String.pipe(Schema.minLength(1)),
});

const InviteInfoResultSchema = Schema.Struct({
  organizationName: Schema.String,
  organizationSlug: Schema.String,
  role: Schema.String,
  expiresAt: Schema.String,
});

// getInviteInfo is callable by any authenticated user with a token. Without a
// tighter cap, a determined attacker could enumerate valid invite tokens at
// the wider 100/min tRPC limit. Rate-limit by caller IP to 10/min. The Map is
// module-scoped and in-memory (ephemeral across Cloudflare Worker isolates);
// this is acceptable because brute-forcing opaque 32-byte tokens remains
// infeasible even at the wider tRPC limit, and a tighter per-isolate cap
// still massively raises the cost.
const GET_INVITE_INFO_LIMIT = 10;
const GET_INVITE_INFO_WINDOW_MS = 60_000;
const getInviteInfoCounters = new Map<string, { count: number; resetAt: number }>();

function checkGetInviteInfoRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = getInviteInfoCounters.get(key);
  if (!entry || now > entry.resetAt) {
    getInviteInfoCounters.set(key, { count: 1, resetAt: now + GET_INVITE_INFO_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= GET_INVITE_INFO_LIMIT;
}

/** @internal exposed for tests */
export function _resetGetInviteInfoRateLimit(): void {
  getInviteInfoCounters.clear();
}

const AcceptInviteResultSchema = Schema.Struct({
  ok: Schema.Boolean,
  organizationId: Schema.String,
  organizationName: Schema.String,
  organizationSlug: Schema.String,
});

const RevokeInviteSchema = Schema.Struct({
  orgId: Schema.String.pipe(Schema.minLength(1)),
  invitationId: Schema.String.pipe(Schema.minLength(1)),
});

/** Creates a URL-safe slug with a random suffix for uniqueness. */
function toSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 40);
  const suffix = crypto.randomUUID().slice(0, 8);
  return base ? `${base}-${suffix}` : suffix;
}

const checkSlug = (slug: string) =>
  Effect.gen(function* () {
    const ctx = yield* UserRequestContextTag;

    const [existing] = yield* tryAsync(() =>
      ctx.db
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.slug, slug))
        .limit(1),
    );

    return { available: !existing };
  });

function serializeOrg(row: typeof organization.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logo: row.logo ?? null,
    createdAt: row.createdAt.toISOString(),
    isPersonal: isPersonalOrg(row.metadata),
  };
}

const slugTaken = (slug: string) =>
  new ConflictError({
    code: "SLUG_TAKEN",
    message: `The slug "${slug}" is already in use`,
    hint: "Choose a different organization slug.",
  });

const createOrg = (input: Schema.Schema.Type<typeof CreateOrganizationSchema>) =>
  Effect.gen(function* () {
    const ctx = yield* UserRequestContextTag;
    const userId = ctx.identity.userId;
    const slug = input.slug ?? toSlug(input.name);

    const [existingSlug] = yield* tryAsync(() =>
      ctx.db
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.slug, slug))
        .limit(1),
    );

    if (existingSlug) {
      return yield* Effect.fail(slugTaken(slug));
    }

    // Org + owner-member + default `server_managed` profile succeed or fail
    // together via the shared seed builder; the slug-race loser's unique
    // violation is translated to SLUG_TAKEN. The auto-seeded profile makes the
    // org immediately usable with no separate `profiles.create` round trip.
    const seed = yield* tryAsync(() =>
      ctx.db.transaction((tx) =>
        seedOrgWithOwnerProfile(tx, {
          userId,
          name: input.name,
          slug,
          logo: input.logo ?? null,
          profileName: "default",
          profileExternalId: "default",
        }),
      ),
    ).pipe(
      Effect.catchIf(
        (e: Error) => isUniqueViolation(e),
        () => Effect.fail(slugTaken(slug)),
      ),
    );

    yield* logUserAudit({
      organizationId: seed.org.id,
      userId,
      eventType: "org.create",
      result: "allowed",
      ipAddress: ctx.ipAddress,
      meta: { slug, autoDefaultProfile: seed.profileId },
    });

    return {
      organization: serializeOrg(seed.org),
      defaultProfile: {
        id: seed.profileId,
        name: "default",
        externalId: "default",
        storageMode: "server_managed" as const,
        keyVersion: 1,
      },
    };
  });

// One-click personal account: no input. Auto-generates a workspace name/slug
// from the user row and seeds a personal org (flagged via metadata) + a single
// server_managed "default" profile via the shared seed builder. toSlug appends
// an 8-char random suffix, so a collision is astronomically rare; if one ever
// occurs it surfaces SLUG_TAKEN (same as createOrg) and the user retries.
// Personal users can still create or join team orgs later — coexistence rides
// on the existing X-Abadge-Org-Id resolution with no extra wiring here.
const createPersonalOrg = Effect.gen(function* () {
  const ctx = yield* UserRequestContextTag;
  const userId = ctx.identity.userId;

  const [userRow] = yield* tryAsync(() =>
    ctx.db
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1),
  );

  const trimmedName = userRow?.name?.trim();
  const displayName = trimmedName ? `${trimmedName}'s workspace` : "Personal workspace";
  const slug = toSlug(trimmedName || userRow?.email?.split("@")[0] || "personal");

  const seed = yield* tryAsync(() =>
    ctx.db.transaction((tx) =>
      seedOrgWithOwnerProfile(tx, {
        userId,
        name: displayName,
        slug,
        metadata: PERSONAL_ORG_METADATA,
        profileName: "default",
        profileExternalId: "default",
      }),
    ),
  ).pipe(
    Effect.catchIf(
      (e: Error) => isUniqueViolation(e),
      () => Effect.fail(slugTaken(slug)),
    ),
  );

  yield* logUserAudit({
    organizationId: seed.org.id,
    userId,
    eventType: "org.create",
    result: "allowed",
    ipAddress: ctx.ipAddress,
    meta: { slug, personal: true, autoDefaultProfile: seed.profileId },
  });

  return {
    organization: serializeOrg(seed.org),
    defaultProfile: {
      id: seed.profileId,
      name: "default",
      externalId: "default",
      storageMode: "server_managed" as const,
      keyVersion: 1,
    },
  };
});

// A user with >100 org memberships is an unusual case; the cap is a sanity
// ceiling so the query/response stays bounded. Ordering by member.createdAt
// keeps the UI deterministic (earliest-joined first). Cursor pagination can be
// added later if real usage exceeds the cap.
const LIST_ORGS_LIMIT = 100;

const listOrgs = Effect.gen(function* () {
  const ctx = yield* UserRequestContextTag;
  const userId = ctx.identity.userId;

  const rows = yield* tryAsync(() =>
    ctx.db
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        logo: organization.logo,
        metadata: organization.metadata,
        createdAt: organization.createdAt,
        role: member.role,
      })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(eq(member.userId, userId))
      .orderBy(asc(member.createdAt))
      .limit(LIST_ORGS_LIMIT),
  );

  // Second query: for each org the user belongs to, determine whether it has a
  // "bootstrapped" profile (server_managed OR zk-with-wrappedRootKey).
  //
  // §AB-0011 — `profiles` is under FORCE RLS keyed on the single-valued
  // `app.current_org` GUC, so a cross-org `inArray(...)` read cannot work under
  // the runtime role: only the one org matching the GUC would be visible and
  // every other org would falsely report "unbootstrapped" (breaking the
  // onboarding redirect for multi-org users). Probe per org inside one
  // transaction, re-setting the GUC each iteration (set_config is mutable within
  // a transaction). orgIds is bounded by LIST_ORGS_LIMIT.
  const orgIds = rows.map((r) => r.id);
  const bootstrappedOrgIds = new Set<string>();
  if (orgIds.length > 0) {
    yield* tryAsync(() =>
      ctx.db.transaction(async (tx) => {
        for (const orgId of orgIds) {
          await tx.execute(sql`select set_config('app.current_org', ${orgId}, true)`);
          const [row] = await tx
            .select({ organizationId: profiles.organizationId })
            .from(profiles)
            .where(
              and(
                eq(profiles.organizationId, orgId),
                or(eq(profiles.storageMode, "server_managed"), isNotNull(profiles.wrappedRootKey)),
              ),
            )
            .limit(1);
          if (row) bootstrappedOrgIds.add(row.organizationId);
        }
      }),
    );
  }

  return {
    organizations: rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      logo: r.logo ?? null,
      createdAt: r.createdAt.toISOString(),
      role: r.role,
      hasBootstrappedProfile: bootstrappedOrgIds.has(r.id),
      isPersonal: isPersonalOrg(r.metadata),
    })),
  };
});

const getOrg = (orgId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const userId = ctx.identity.userId;

    yield* tryAsync(() => requireOrgRole(ctx.db, orgId, userId, "member")).pipe(
      Effect.tapError((err) =>
        err instanceof ForbiddenError
          ? logSessionAudit({
              organizationId: ctx.identity.organizationId,
              userId,
              eventType: "org.read",
              result: "denied",
              ipAddress: ctx.ipAddress,
              meta: { reason: "insufficient_role", targetOrgId: orgId },
            })
          : Effect.void,
      ),
    );

    const [org] = yield* tryAsync(() =>
      ctx.db.select().from(organization).where(eq(organization.id, orgId)).limit(1),
    );

    if (!org) {
      return yield* Effect.fail(
        new NotFoundError({
          code: "NOT_FOUND",
          message: "Organization not found",
          hint: "Check the organization ID and make sure you are a member.",
        }),
      );
    }

    return { organization: serializeOrg(org) };
  });

const updateOrg = (input: Schema.Schema.Type<typeof UpdateOrganizationSchema>) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const { orgId, ...updates } = input;

    yield* tryAsync(() => requireOrgRole(ctx.db, orgId, ctx.identity.userId, "owner")).pipe(
      Effect.tapError((err) =>
        err instanceof ForbiddenError
          ? logSessionAudit({
              organizationId: ctx.identity.organizationId,
              userId: ctx.identity.userId,
              eventType: "org.update",
              result: "denied",
              ipAddress: ctx.ipAddress,
              meta: { reason: "insufficient_role", targetOrgId: orgId },
            })
          : Effect.void,
      ),
    );

    const setValues: Record<string, unknown> = {};
    if (updates.name !== undefined) setValues.name = updates.name;
    if (updates.logo !== undefined) setValues.logo = updates.logo;

    if (Object.keys(setValues).length > 0) {
      yield* tryAsync(() =>
        ctx.db.update(organization).set(setValues).where(eq(organization.id, orgId)),
      );

      yield* logSessionAudit({
        organizationId: orgId,
        userId: ctx.identity.userId,
        eventType: "org.update",
        result: "allowed",
        ipAddress: ctx.ipAddress,
        meta: { fields: Object.keys(setValues) },
      });
    }

    return { ok: true };
  });

const deleteOrg = (orgId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;

    yield* tryAsync(() => requireOrgRole(ctx.db, orgId, ctx.identity.userId, "owner")).pipe(
      Effect.tapError((err) =>
        err instanceof ForbiddenError
          ? logSessionAudit({
              organizationId: ctx.identity.organizationId,
              userId: ctx.identity.userId,
              eventType: "org.delete",
              result: "denied",
              ipAddress: ctx.ipAddress,
              meta: { reason: "insufficient_role", targetOrgId: orgId },
            })
          : Effect.void,
      ),
    );

    // §AB-0011 — `items` is under FORCE RLS; set the org GUC so this guard read
    // sees the org's rows under the runtime role (otherwise it returns zero and a
    // non-empty org would be deletable, bypassing the ORG_NOT_EMPTY safety check).
    const activeItems = yield* tryAsync(() =>
      ctx.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.current_org', ${orgId}, true)`);
        return tx
          .select({ id: items.id })
          .from(items)
          .where(and(eq(items.organizationId, orgId), isNull(items.deletedAt)))
          .limit(1);
      }),
    );

    if (activeItems.length > 0) {
      return yield* Effect.fail(
        new ConflictError({
          code: "ORG_NOT_EMPTY",
          message: "Organization still has active items",
          hint: "Delete all items in this organization before deleting it.",
        }),
      );
    }

    yield* tryAsync(() => ctx.db.delete(organization).where(eq(organization.id, orgId)));

    yield* logSessionAudit({
      organizationId: orgId,
      userId: ctx.identity.userId,
      eventType: "org.delete",
      result: "allowed",
      ipAddress: ctx.ipAddress,
    });

    return { ok: true };
  });

const listMembers = (orgId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;

    // Gate email disclosure by the caller's role: plain members must not be
    // able to enumerate teammates' email addresses (mild PII leak + internal
    // contact list). Strict policy applied uniformly — callers do not see
    // their own email in this list either; they can read it from their
    // profile/settings. Owners and admins see all emails so they can manage
    // membership and invites.
    const callerRole = yield* tryAsync(() =>
      requireOrgRole(ctx.db, orgId, ctx.identity.userId, "member"),
    ).pipe(
      Effect.tapError((err) =>
        err instanceof ForbiddenError
          ? logSessionAudit({
              organizationId: ctx.identity.organizationId,
              userId: ctx.identity.userId,
              eventType: "org.member_list",
              result: "denied",
              ipAddress: ctx.ipAddress,
              meta: { reason: "not_member", targetOrgId: orgId },
            })
          : Effect.void,
      ),
    );
    const canSeeEmail = callerRole === "owner" || callerRole === "admin";

    const rows = yield* tryAsync(() =>
      ctx.db
        .select({
          id: member.id,
          userId: member.userId,
          role: member.role,
          createdAt: member.createdAt,
          userName: user.name,
          userEmail: user.email,
        })
        .from(member)
        .leftJoin(user, eq(user.id, member.userId))
        .where(eq(member.organizationId, orgId)),
    );

    return {
      members: rows.map((m) => ({
        id: m.id,
        userId: m.userId,
        name: m.userName ?? "",
        email: canSeeEmail ? (m.userEmail ?? null) : null,
        role: m.role,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  });

const createInvite = (input: Schema.Schema.Type<typeof CreateInviteSchema>) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const { orgId, role } = input;

    const actorRole = yield* tryAsync(() =>
      requireOrgRole(ctx.db, orgId, ctx.identity.userId, "admin"),
    ).pipe(
      Effect.tapError((err) =>
        err instanceof ForbiddenError
          ? logSessionAudit({
              organizationId: ctx.identity.organizationId,
              userId: ctx.identity.userId,
              eventType: "org.invite",
              result: "denied",
              ipAddress: ctx.ipAddress,
              meta: { reason: "insufficient_role", targetOrgId: orgId },
            })
          : Effect.void,
      ),
    );

    // §INV1a: Prevent admins from minting owner-role invites (privilege escalation
    // via invite-accept round-trip). The invited role must not exceed the caller's role.
    const inviteRole = role ?? "member";
    yield* tryAsync(async () => assertCanAssignRole(actorRole, inviteRole)).pipe(
      Effect.tapError((err) =>
        err instanceof ForbiddenError
          ? logSessionAudit({
              organizationId: ctx.identity.organizationId,
              userId: ctx.identity.userId,
              eventType: "org.invite",
              result: "denied",
              ipAddress: ctx.ipAddress,
              meta: { reason: "invite_role_exceeds_actor_role", inviteRole, actorRole },
            })
          : Effect.void,
      ),
    );

    const token = generateOpaqueToken(INVITE_TOKEN_PREFIX);
    const tokenHash = yield* tryAsync(() => hashApiKey(token));
    const invitationId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_MS);

    yield* tryAsync(() =>
      ctx.db.insert(invitation).values({
        id: invitationId,
        organizationId: orgId,
        role: inviteRole,
        status: "pending",
        tokenHash,
        expiresAt,
        inviterId: ctx.identity.userId,
        createdAt: new Date(),
      }),
    );

    yield* logSessionAudit({
      organizationId: orgId,
      userId: ctx.identity.userId,
      eventType: "org.invite",
      result: "allowed",
      ipAddress: ctx.ipAddress,
      meta: { role: inviteRole, invitationId },
    });

    return { ok: true, invitationId, token };
  });

const getInviteInfo = (token: string) =>
  Effect.gen(function* () {
    const ctx = yield* UserRequestContextTag;

    // Throttle before paying the hashing cost so rejected attempts are cheap.
    const rateLimitKey = `${ctx.identity.userId}:${ctx.ipAddress ?? "unknown"}`;
    if (!checkGetInviteInfoRateLimit(rateLimitKey)) {
      return yield* Effect.fail(
        new RateLimitError({
          code: "RATE_LIMITED",
          message: "Too many invite lookups",
          hint: "Wait a minute before retrying the invite link.",
        }),
      );
    }

    const tokenHash = yield* tryAsync(() => hashApiKey(token));

    const [row] = yield* tryAsync(() =>
      ctx.db
        .select({
          role: invitation.role,
          expiresAt: invitation.expiresAt,
          usedAt: invitation.usedAt,
          orgName: organization.name,
          orgSlug: organization.slug,
        })
        .from(invitation)
        .innerJoin(organization, eq(organization.id, invitation.organizationId))
        .where(eq(invitation.tokenHash, tokenHash))
        .limit(1),
    );

    if (!row) {
      return yield* Effect.fail(
        new NotFoundError({
          code: "INVITE_NOT_FOUND",
          message: "Invitation not found",
          hint: "The invite link may be invalid. Ask for a new one.",
        }),
      );
    }

    if (row.usedAt) {
      return yield* Effect.fail(
        new ConflictError({
          code: "INVITE_ALREADY_USED",
          message: "This invitation has already been used",
          hint: "Ask the organization admin for a new invite link.",
        }),
      );
    }

    if (row.expiresAt < new Date()) {
      return yield* Effect.fail(
        new NotFoundError({
          code: "INVITE_EXPIRED",
          message: "This invitation has expired",
          hint: "Ask the organization admin for a new invite link.",
        }),
      );
    }

    return {
      organizationName: row.orgName,
      organizationSlug: row.orgSlug,
      role: row.role ?? "member",
      expiresAt: row.expiresAt.toISOString(),
    };
  });

const acceptInvite = (token: string) =>
  Effect.gen(function* () {
    const ctx = yield* UserRequestContextTag;
    const userId = ctx.identity.userId;
    const tokenHash = yield* tryAsync(() => hashApiKey(token));

    // Single query: find the invite with org data, verify unused + not expired
    const [row] = yield* tryAsync(() =>
      ctx.db
        .select({
          id: invitation.id,
          organizationId: invitation.organizationId,
          role: invitation.role,
          expiresAt: invitation.expiresAt,
          usedAt: invitation.usedAt,
          orgName: organization.name,
          orgSlug: organization.slug,
        })
        .from(invitation)
        .innerJoin(organization, eq(organization.id, invitation.organizationId))
        .where(eq(invitation.tokenHash, tokenHash))
        .limit(1),
    );

    if (!row) {
      return yield* Effect.fail(
        new NotFoundError({
          code: "INVITE_NOT_FOUND",
          message: "Invitation not found",
          hint: "The invite link may be invalid. Ask for a new one.",
        }),
      );
    }

    if (row.usedAt) {
      return yield* Effect.fail(
        new ConflictError({
          code: "INVITE_ALREADY_USED",
          message: "This invitation has already been used",
          hint: "Ask the organization admin for a new invite link.",
        }),
      );
    }

    if (row.expiresAt < new Date()) {
      return yield* Effect.fail(
        new NotFoundError({
          code: "INVITE_EXPIRED",
          message: "This invitation has expired",
          hint: "Ask the organization admin for a new invite link.",
        }),
      );
    }

    // Check if user is already a member
    const [existingMember] = yield* tryAsync(() =>
      ctx.db
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.organizationId, row.organizationId), eq(member.userId, userId)))
        .limit(1),
    );

    if (existingMember) {
      return yield* Effect.fail(
        new ConflictError({
          code: "ALREADY_MEMBER",
          message: "You are already a member of this organization",
          hint: "You can access this organization from your dashboard.",
        }),
      );
    }

    // Atomically mark the invite as used — WHERE usedAt IS NULL prevents double-accept race
    const updated = yield* tryAsync(() =>
      ctx.db
        .update(invitation)
        .set({ usedAt: new Date(), usedBy: userId, status: "accepted" })
        .where(and(eq(invitation.id, row.id), isNull(invitation.usedAt)))
        .returning({ id: invitation.id }),
    );

    if (updated.length === 0) {
      // Another request beat us — the invite was just used
      return yield* Effect.fail(
        new ConflictError({
          code: "INVITE_ALREADY_USED",
          message: "This invitation was just accepted by someone else",
          hint: "Ask the organization admin for a new invite link.",
        }),
      );
    }

    // Add user as member
    yield* tryAsync(() =>
      ctx.db.insert(member).values({
        id: crypto.randomUUID(),
        organizationId: row.organizationId,
        userId,
        role: row.role ?? "member",
        createdAt: new Date(),
      }),
    );

    yield* logUserAudit({
      organizationId: row.organizationId,
      userId,
      eventType: "org.invite_accept",
      result: "allowed",
      ipAddress: ctx.ipAddress,
      meta: { invitationId: row.id, role: row.role ?? "member" },
    });

    return {
      ok: true,
      organizationId: row.organizationId,
      organizationName: row.orgName,
      organizationSlug: row.orgSlug,
    };
  });

const revokeInvite = (input: Schema.Schema.Type<typeof RevokeInviteSchema>) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const { orgId, invitationId } = input;

    yield* tryAsync(() => requireOrgRole(ctx.db, orgId, ctx.identity.userId, "admin")).pipe(
      Effect.tapError((err) =>
        err instanceof ForbiddenError
          ? logSessionAudit({
              organizationId: ctx.identity.organizationId,
              userId: ctx.identity.userId,
              eventType: "org.invite_revoke",
              result: "denied",
              ipAddress: ctx.ipAddress,
              meta: { reason: "insufficient_role", targetOrgId: orgId },
            })
          : Effect.void,
      ),
    );

    const deleted = yield* tryAsync(() =>
      ctx.db
        .delete(invitation)
        .where(
          and(
            eq(invitation.id, invitationId),
            eq(invitation.organizationId, orgId),
            isNull(invitation.usedAt),
          ),
        )
        .returning({ id: invitation.id }),
    );

    if (deleted.length === 0) {
      return yield* Effect.fail(
        new NotFoundError({
          code: "INVITE_NOT_FOUND",
          message: "Pending invitation not found",
          hint: "It may have already been used or revoked.",
        }),
      );
    }

    yield* logSessionAudit({
      organizationId: orgId,
      userId: ctx.identity.userId,
      eventType: "org.invite_revoke",
      result: "allowed",
      ipAddress: ctx.ipAddress,
      meta: { invitationId },
    });

    return { ok: true };
  });

const removeMember = (input: Schema.Schema.Type<typeof RemoveMemberSchema>) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const { orgId, memberId } = input;

    const actorRole = yield* tryAsync(() =>
      requireOrgRole(ctx.db, orgId, ctx.identity.userId, "admin"),
    ).pipe(
      Effect.tapError((err) =>
        err instanceof ForbiddenError
          ? logSessionAudit({
              organizationId: ctx.identity.organizationId,
              userId: ctx.identity.userId,
              eventType: "org.member_remove",
              result: "denied",
              ipAddress: ctx.ipAddress,
              meta: { reason: "insufficient_role", targetOrgId: orgId, memberId },
            })
          : Effect.void,
      ),
    );

    const [target] = yield* tryAsync(() =>
      ctx.db
        .select()
        .from(member)
        .where(and(eq(member.id, memberId), eq(member.organizationId, orgId)))
        .limit(1),
    );

    if (!target) {
      return yield* Effect.fail(
        new NotFoundError({
          code: "NOT_FOUND",
          message: "Member not found",
          hint: "Check the member ID and make sure they belong to this organization.",
        }),
      );
    }

    // §OWN2a: Only owners can remove owners; admins can remove admins + members.
    if (target.role === "owner" && actorRole !== "owner") {
      yield* logSessionAudit({
        organizationId: ctx.identity.organizationId,
        userId: ctx.identity.userId,
        eventType: "org.member_remove",
        result: "denied",
        ipAddress: ctx.ipAddress,
        meta: { reason: "insufficient_role_for_owner_removal", memberId, actorRole },
      });
      return yield* Effect.fail(
        new ForbiddenError({
          code: "MEMBER_INSUFFICIENT_ROLE",
          message: "Only an owner can remove another owner",
          hint: "Ask an owner to perform this removal.",
        }),
      );
    }

    // §OWN2b / B37: Do not strand the org with zero owners.
    yield* tryAsync(() =>
      assertOwnersRemainAfterChange(ctx.db, orgId, memberId, target.role, "removed"),
    );

    // Atomic: delete the member row, write the org.member_remove audit
    // entry, and run the cascade that revokes their agents, sessions, and
    // granted permissions — all inside one transaction. Prior shape ran
    // these as three sequential tryAsync steps without a shared tx, so a
    // mid-flight failure (DB blip, cascade throw) could leave the member
    // gone but their credentials still live. `onMemberRemoved` internally
    // opens a transaction on the db-or-tx it is handed; Postgres treats
    // that inner call as a savepoint on this outer tx.
    //
    // The audit insert is written inline rather than through
    // logSessionAudit so it shares the same tx; logSessionAudit closes
    // over ctx.db and would commit outside the transaction boundary.
    yield* tryAsync(() =>
      ctx.db.transaction(async (tx) => {
        // §AB-0011 — removeMember runs on sessionProcedure (no GUC middleware), but
        // onMemberRemoved deletes the removed member's `permissions` rows (an RLS
        // table). Set the org GUC first or the cascade delete affects zero rows
        // under the runtime role and stale grants survive the removal.
        await tx.execute(sql`select set_config('app.current_org', ${orgId}, true)`);

        await tx.delete(member).where(eq(member.id, memberId));

        await tx.insert(auditLogs).values({
          organizationId: orgId,
          userId: ctx.identity.userId,
          surface: "api",
          eventType: "org.member_remove",
          result: "allowed",
          ipAddress: ctx.ipAddress ?? null,
          meta: { removedUserId: target.userId, memberId },
        });

        await onMemberRemoved(tx, orgId, target.userId, ctx.identity.userId, ctx.ipAddress);
      }),
    );

    return { ok: true };
  });

const updateMemberRole = (input: Schema.Schema.Type<typeof UpdateMemberRoleSchema>) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const { orgId, memberId, role } = input;

    yield* tryAsync(() => requireOrgRole(ctx.db, orgId, ctx.identity.userId, "owner")).pipe(
      Effect.tapError((err) =>
        err instanceof ForbiddenError
          ? logSessionAudit({
              organizationId: ctx.identity.organizationId,
              userId: ctx.identity.userId,
              eventType: "org.member_role_change",
              result: "denied",
              ipAddress: ctx.ipAddress,
              meta: { reason: "insufficient_role", targetOrgId: orgId, memberId },
            })
          : Effect.void,
      ),
    );

    const [target] = yield* tryAsync(() =>
      ctx.db
        .select({ id: member.id, role: member.role })
        .from(member)
        .where(and(eq(member.id, memberId), eq(member.organizationId, orgId)))
        .limit(1),
    );

    if (!target) {
      return yield* Effect.fail(
        new NotFoundError({
          code: "NOT_FOUND",
          message: "Member not found",
          hint: "Check the member ID and make sure they belong to this organization.",
        }),
      );
    }

    // §OWN1 / B37: Do not strand the org with zero owners when demoting the last owner.
    yield* tryAsync(() =>
      assertOwnersRemainAfterChange(ctx.db, orgId, memberId, target.role, role),
    );

    yield* tryAsync(() => ctx.db.update(member).set({ role }).where(eq(member.id, memberId)));

    yield* logSessionAudit({
      organizationId: orgId,
      userId: ctx.identity.userId,
      eventType: "org.member_role_change",
      result: "allowed",
      ipAddress: ctx.ipAddress,
      meta: { memberId, newRole: role },
    });

    return { ok: true };
  });

export const organizationsRouter = createTrpcRouter({
  create: userProcedure
    .meta({ openapi: { method: "POST", path: "/orgs", tags: ["organizations"], protect: true } })
    .input(strictSchema(CreateOrganizationSchema))
    .output(strictSchema(CreateOrgResultSchema))
    .mutation(({ ctx, input }) => runUserEffect(ctx, createOrg(input))),

  createPersonal: userProcedure
    .meta({
      openapi: { method: "POST", path: "/orgs/personal", tags: ["organizations"], protect: true },
    })
    .output(strictSchema(CreateOrgResultSchema))
    .mutation(({ ctx }) => runUserEffect(ctx, createPersonalOrg)),

  checkSlug: userProcedure
    .input(strictSchema(CheckSlugSchema))
    .output(strictSchema(CheckSlugResultSchema))
    .query(({ ctx, input }) => runUserEffect(ctx, checkSlug(input.slug))),

  list: userProcedure
    .meta({ openapi: { method: "GET", path: "/orgs", tags: ["organizations"], protect: true } })
    .output(strictSchema(OrgListResultSchema))
    .query(({ ctx }) => runUserEffect(ctx, listOrgs)),

  get: sessionProcedure
    .meta({
      openapi: { method: "GET", path: "/orgs/{orgId}", tags: ["organizations"], protect: true },
    })
    .input(strictSchema(OrgIdSchema))
    .output(strictSchema(OrgResultSchema))
    .query(({ ctx, input }) => runSessionEffect(ctx, getOrg(input.orgId))),

  update: sessionProcedure
    .meta({
      openapi: { method: "PATCH", path: "/orgs/{orgId}", tags: ["organizations"], protect: true },
    })
    .input(strictSchema(UpdateOrganizationSchema))
    .output(strictSchema(SuccessResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, updateOrg(input))),

  delete: sessionProcedure
    .meta({
      openapi: { method: "DELETE", path: "/orgs/{orgId}", tags: ["organizations"], protect: true },
    })
    .input(strictSchema(OrgIdSchema))
    .output(strictSchema(SuccessResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, deleteOrg(input.orgId))),

  members: createTrpcRouter({
    list: sessionProcedure
      .meta({
        openapi: {
          method: "GET",
          path: "/orgs/{orgId}/members",
          tags: ["members"],
          protect: true,
        },
      })
      .input(strictSchema(OrgIdSchema))
      .output(strictSchema(MemberListResultSchema))
      .query(({ ctx, input }) => runSessionEffect(ctx, listMembers(input.orgId))),

    invite: sessionProcedure
      .meta({
        openapi: {
          method: "POST",
          path: "/orgs/{orgId}/members",
          tags: ["members"],
          protect: true,
        },
      })
      .input(strictSchema(CreateInviteSchema))
      .output(strictSchema(CreateInviteResultSchema))
      .mutation(({ ctx, input }) => runSessionEffect(ctx, createInvite(input))),

    getInviteInfo: userProcedure
      .input(strictSchema(InviteTokenSchema))
      .output(strictSchema(InviteInfoResultSchema))
      .query(({ ctx, input }) => runUserEffect(ctx, getInviteInfo(input.token))),

    acceptInvite: userProcedure
      .meta({
        openapi: { method: "POST", path: "/invites/accept", tags: ["members"], protect: true },
      })
      .input(strictSchema(InviteTokenSchema))
      .output(strictSchema(AcceptInviteResultSchema))
      .mutation(({ ctx, input }) => runUserEffect(ctx, acceptInvite(input.token))),

    revokeInvite: sessionProcedure
      .input(strictSchema(RevokeInviteSchema))
      .output(strictSchema(SuccessResultSchema))
      .mutation(({ ctx, input }) => runSessionEffect(ctx, revokeInvite(input))),

    remove: sessionProcedure
      .meta({
        openapi: {
          method: "DELETE",
          path: "/orgs/{orgId}/members/{memberId}",
          tags: ["members"],
          protect: true,
        },
      })
      .input(strictSchema(RemoveMemberSchema))
      .output(strictSchema(SuccessResultSchema))
      .mutation(({ ctx, input }) => runSessionEffect(ctx, removeMember(input))),

    updateRole: sessionProcedure
      .meta({
        openapi: {
          method: "PATCH",
          path: "/orgs/{orgId}/members/{memberId}",
          tags: ["members"],
          protect: true,
        },
      })
      .input(strictSchema(UpdateMemberRoleSchema))
      .output(strictSchema(SuccessResultSchema))
      .mutation(({ ctx, input }) => runSessionEffect(ctx, updateMemberRole(input))),
  }),
});

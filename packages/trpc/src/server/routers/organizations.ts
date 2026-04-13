import {
  ConflictError,
  INVITE_TOKEN_PREFIX,
  INVITE_TOKEN_TTL_MS,
  NotFoundError,
  SuccessResultSchema,
} from "@abadge/core";
import { generateOpaqueToken, hashApiKey } from "@abadge/crypto/shared";
import { and, eq, isNull } from "@abadge/db";
import { invitation, items, member, organization, profiles, user } from "@abadge/db/schema";
import { Effect, Schema } from "effect";
import { logSessionAudit } from "../audit";
import { onMemberRemoved } from "../cascades";
import { runSessionEffect, SessionRequestContextTag, strictSchema, tryAsync } from "../effect";
import { createTrpcRouter, requireOrgRole, sessionProcedure } from "../init";

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
});

const OrgListItemSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  logo: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  role: Schema.String,
});

const CreateOrgResultSchema = Schema.Struct({
  organization: OrgDataSchema,
  profileId: Schema.String,
});

const OrgResultSchema = Schema.Struct({
  organization: OrgDataSchema,
});

const OrgListResultSchema = Schema.Struct({
  organizations: Schema.Array(OrgListItemSchema),
});

const MemberDataSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  name: Schema.String,
  email: Schema.String,
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
  invitationId: Schema.String,
  organizationName: Schema.String,
  organizationSlug: Schema.String,
  role: Schema.String,
  expiresAt: Schema.String,
  inviterUserId: Schema.String,
});

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
    const ctx = yield* SessionRequestContextTag;

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
  };
}

const createOrg = (input: Schema.Schema.Type<typeof CreateOrganizationSchema>) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const userId = ctx.identity.userId;
    const orgId = crypto.randomUUID();
    const profileId = crypto.randomUUID();
    const slug = input.slug ?? toSlug(input.name);
    const now = new Date();

    const [existingSlug] = yield* tryAsync(() =>
      ctx.db
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.slug, slug))
        .limit(1),
    );

    if (existingSlug) {
      return yield* Effect.fail(
        new ConflictError({
          code: "SLUG_TAKEN",
          message: `The slug "${slug}" is already in use`,
          hint: "Choose a different organization slug.",
        }),
      );
    }

    yield* tryAsync(() =>
      ctx.db.insert(organization).values({
        id: orgId,
        name: input.name,
        slug,
        logo: input.logo ?? null,
        createdAt: now,
      }),
    );

    yield* tryAsync(() =>
      ctx.db.insert(member).values({
        id: crypto.randomUUID(),
        organizationId: orgId,
        userId,
        role: "owner",
        createdAt: now,
      }),
    );

    // Create a default zero-knowledge profile for the org.
    yield* tryAsync(() =>
      ctx.db.insert(profiles).values({
        id: profileId,
        organizationId: orgId,
        name: "default",
        storageMode: "zero_knowledge",
        createdAt: now,
        updatedAt: now,
      }),
    );

    yield* logSessionAudit({
      organizationId: orgId,
      userId,
      eventType: "org.create",
      result: "allowed",
      ipAddress: ctx.ipAddress,
      meta: { slug },
    });

    yield* logSessionAudit({
      organizationId: orgId,
      userId,
      eventType: "profile.create",
      result: "allowed",
      ipAddress: ctx.ipAddress,
      meta: { orgId },
    });

    return {
      organization: {
        id: orgId,
        name: input.name,
        slug,
        logo: input.logo ?? null,
        createdAt: now.toISOString(),
      },
      profileId,
    };
  });

const listOrgs = Effect.gen(function* () {
  const ctx = yield* SessionRequestContextTag;
  const userId = ctx.identity.userId;

  const rows = yield* tryAsync(() =>
    ctx.db
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        logo: organization.logo,
        createdAt: organization.createdAt,
        role: member.role,
      })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(eq(member.userId, userId)),
  );

  return {
    organizations: rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      logo: r.logo ?? null,
      createdAt: r.createdAt.toISOString(),
      role: r.role,
    })),
  };
});

const getOrg = (orgId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const userId = ctx.identity.userId;

    yield* tryAsync(() => requireOrgRole(ctx.db, orgId, userId, "member"));

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

    yield* tryAsync(() => requireOrgRole(ctx.db, orgId, ctx.identity.userId, "owner"));

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

    yield* tryAsync(() => requireOrgRole(ctx.db, orgId, ctx.identity.userId, "owner"));

    const activeItems = yield* tryAsync(() =>
      ctx.db
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.organizationId, orgId), isNull(items.deletedAt)))
        .limit(1),
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

    yield* tryAsync(() => requireOrgRole(ctx.db, orgId, ctx.identity.userId, "member"));

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
        email: m.userEmail ?? "",
        role: m.role,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  });

const createInvite = (input: Schema.Schema.Type<typeof CreateInviteSchema>) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const { orgId, role } = input;

    yield* tryAsync(() => requireOrgRole(ctx.db, orgId, ctx.identity.userId, "admin"));

    const token = generateOpaqueToken(INVITE_TOKEN_PREFIX);
    const tokenHash = yield* tryAsync(() => hashApiKey(token));
    const invitationId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_MS);

    yield* tryAsync(() =>
      ctx.db.insert(invitation).values({
        id: invitationId,
        organizationId: orgId,
        role: role ?? "member",
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
      meta: { role: role ?? "member", invitationId },
    });

    return { ok: true, invitationId, token };
  });

const getInviteInfo = (token: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const tokenHash = yield* tryAsync(() => hashApiKey(token));

    const [row] = yield* tryAsync(() =>
      ctx.db
        .select({
          id: invitation.id,
          organizationId: invitation.organizationId,
          role: invitation.role,
          expiresAt: invitation.expiresAt,
          usedAt: invitation.usedAt,
          inviterId: invitation.inviterId,
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
      invitationId: row.id,
      organizationName: row.orgName,
      organizationSlug: row.orgSlug,
      role: row.role ?? "member",
      expiresAt: row.expiresAt.toISOString(),
      inviterUserId: row.inviterId,
    };
  });

const acceptInvite = (token: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
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

    yield* logSessionAudit({
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

    yield* tryAsync(() => requireOrgRole(ctx.db, orgId, ctx.identity.userId, "admin"));

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

    yield* tryAsync(() => requireOrgRole(ctx.db, orgId, ctx.identity.userId, "admin"));

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

    yield* tryAsync(() => ctx.db.delete(member).where(eq(member.id, memberId)));

    yield* logSessionAudit({
      organizationId: orgId,
      userId: ctx.identity.userId,
      eventType: "org.member_remove",
      result: "allowed",
      ipAddress: ctx.ipAddress,
      meta: { removedUserId: target.userId, memberId },
    });

    yield* tryAsync(() =>
      onMemberRemoved(ctx.db, orgId, target.userId, ctx.identity.userId, ctx.ipAddress),
    );

    return { ok: true };
  });

const updateMemberRole = (input: Schema.Schema.Type<typeof UpdateMemberRoleSchema>) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const { orgId, memberId, role } = input;

    yield* tryAsync(() => requireOrgRole(ctx.db, orgId, ctx.identity.userId, "owner"));

    const [target] = yield* tryAsync(() =>
      ctx.db
        .select({ id: member.id })
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
  create: sessionProcedure
    .input(strictSchema(CreateOrganizationSchema))
    .output(strictSchema(CreateOrgResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, createOrg(input))),

  checkSlug: sessionProcedure
    .input(strictSchema(CheckSlugSchema))
    .output(strictSchema(CheckSlugResultSchema))
    .query(({ ctx, input }) => runSessionEffect(ctx, checkSlug(input.slug))),

  list: sessionProcedure
    .output(strictSchema(OrgListResultSchema))
    .query(({ ctx }) => runSessionEffect(ctx, listOrgs)),

  get: sessionProcedure
    .input(strictSchema(OrgIdSchema))
    .output(strictSchema(OrgResultSchema))
    .query(({ ctx, input }) => runSessionEffect(ctx, getOrg(input.orgId))),

  update: sessionProcedure
    .input(strictSchema(UpdateOrganizationSchema))
    .output(strictSchema(SuccessResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, updateOrg(input))),

  delete: sessionProcedure
    .input(strictSchema(OrgIdSchema))
    .output(strictSchema(SuccessResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, deleteOrg(input.orgId))),

  members: createTrpcRouter({
    list: sessionProcedure
      .input(strictSchema(OrgIdSchema))
      .output(strictSchema(MemberListResultSchema))
      .query(({ ctx, input }) => runSessionEffect(ctx, listMembers(input.orgId))),

    invite: sessionProcedure
      .input(strictSchema(CreateInviteSchema))
      .output(strictSchema(CreateInviteResultSchema))
      .mutation(({ ctx, input }) => runSessionEffect(ctx, createInvite(input))),

    getInviteInfo: sessionProcedure
      .input(strictSchema(InviteTokenSchema))
      .output(strictSchema(InviteInfoResultSchema))
      .query(({ ctx, input }) => runSessionEffect(ctx, getInviteInfo(input.token))),

    acceptInvite: sessionProcedure
      .input(strictSchema(InviteTokenSchema))
      .output(strictSchema(AcceptInviteResultSchema))
      .mutation(({ ctx, input }) => runSessionEffect(ctx, acceptInvite(input.token))),

    revokeInvite: sessionProcedure
      .input(strictSchema(RevokeInviteSchema))
      .output(strictSchema(SuccessResultSchema))
      .mutation(({ ctx, input }) => runSessionEffect(ctx, revokeInvite(input))),

    remove: sessionProcedure
      .input(strictSchema(RemoveMemberSchema))
      .output(strictSchema(SuccessResultSchema))
      .mutation(({ ctx, input }) => runSessionEffect(ctx, removeMember(input))),

    updateRole: sessionProcedure
      .input(strictSchema(UpdateMemberRoleSchema))
      .output(strictSchema(SuccessResultSchema))
      .mutation(({ ctx, input }) => runSessionEffect(ctx, updateMemberRole(input))),
  }),
});

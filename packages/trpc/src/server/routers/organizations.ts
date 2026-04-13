import { ConflictError, NotFoundError, SuccessResultSchema } from "@abadge/core";
import { and, eq, inArray, isNull } from "@abadge/db";
import { invitation, items, member, organization, profiles } from "@abadge/db/schema";
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
  logo: Schema.optional(Schema.String),
});

const UpdateOrganizationSchema = Schema.Struct({
  orgId: Schema.String.pipe(Schema.minLength(1)),
  name: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(255))),
  logo: Schema.optional(Schema.String),
});

const InviteMemberSchema = Schema.Struct({
  orgId: Schema.String.pipe(Schema.minLength(1)),
  email: Schema.String.pipe(Schema.minLength(1)),
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

const OrgDataSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  logo: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
});

const CreateOrgResultSchema = Schema.Struct({
  organization: OrgDataSchema,
  profileId: Schema.String,
});

const OrgResultSchema = Schema.Struct({
  organization: OrgDataSchema,
});

const OrgListResultSchema = Schema.Struct({
  organizations: Schema.Array(OrgDataSchema),
});

const MemberDataSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  role: Schema.String,
  createdAt: Schema.String,
});

const MemberListResultSchema = Schema.Struct({
  members: Schema.Array(MemberDataSchema),
});

const InviteResultSchema = Schema.Struct({
  ok: Schema.Boolean,
  invitationId: Schema.String,
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
    const slug = toSlug(input.name);
    const now = new Date();

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

  const memberRows = yield* tryAsync(() =>
    ctx.db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, userId)),
  );

  if (memberRows.length === 0) {
    return { organizations: [] };
  }

  const orgIds = memberRows.map((r) => r.organizationId);
  const orgs = yield* tryAsync(() =>
    ctx.db.select().from(organization).where(inArray(organization.id, orgIds)),
  );

  return { organizations: orgs.map(serializeOrg) };
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

    return { ok: true };
  });

const listMembers = (orgId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;

    yield* tryAsync(() => requireOrgRole(ctx.db, orgId, ctx.identity.userId, "member"));

    const members = yield* tryAsync(() =>
      ctx.db.select().from(member).where(eq(member.organizationId, orgId)),
    );

    return {
      members: members.map((m) => ({
        id: m.id,
        userId: m.userId,
        role: m.role,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  });

const inviteMember = (input: Schema.Schema.Type<typeof InviteMemberSchema>) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const { orgId, email, role } = input;

    yield* tryAsync(() => requireOrgRole(ctx.db, orgId, ctx.identity.userId, "admin"));

    const invitationId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    yield* tryAsync(() =>
      ctx.db.insert(invitation).values({
        id: invitationId,
        organizationId: orgId,
        email,
        role: role ?? "member",
        status: "pending",
        expiresAt,
        inviterId: ctx.identity.userId,
        createdAt: new Date(),
      }),
    );

    return { ok: true, invitationId };
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

    yield* tryAsync(() => onMemberRemoved(ctx.db, orgId, target.userId, ctx.identity.userId));

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

    return { ok: true };
  });

export const organizationsRouter = createTrpcRouter({
  create: sessionProcedure
    .input(strictSchema(CreateOrganizationSchema))
    .output(strictSchema(CreateOrgResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, createOrg(input))),

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
      .input(strictSchema(InviteMemberSchema))
      .output(strictSchema(InviteResultSchema))
      .mutation(({ ctx, input }) => runSessionEffect(ctx, inviteMember(input))),

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

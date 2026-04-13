import {
  ConflictError,
  type KdfParams,
  NotFoundError,
  ProfileListResultSchema,
  ProfileResultSchema,
  SuccessResultSchema,
} from "@abadge/core";
import { and, eq, isNull } from "@abadge/db";
import { items, profiles } from "@abadge/db/schema";
import { Effect, Schema } from "effect";
import { logSessionAudit } from "../audit";
import { runSessionEffect, SessionRequestContextTag, strictSchema, tryAsync } from "../effect";
import { createTrpcRouter, requireOrgRole, sessionProcedure } from "../init";
import { serializeProfile } from "../serialize";

const NonEmptyString = Schema.String.pipe(Schema.minLength(1));
const BoundedNameString = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(255));

const OrgIdSchema = Schema.Struct({
  orgId: NonEmptyString,
});

const ProfileIdSchema = Schema.Struct({
  profileId: NonEmptyString,
});

const CreateProfileSchema = Schema.Struct({
  orgId: NonEmptyString,
  name: BoundedNameString,
  description: Schema.optional(Schema.String),
  storageMode: Schema.Literal("zero_knowledge", "server_managed"),
});

const ProfileBootstrapSchema = Schema.Struct({
  profileId: NonEmptyString,
  wrappedRootKey: NonEmptyString,
  kdfSalt: NonEmptyString,
  kdfParams: Schema.Struct({
    algorithm: Schema.Literal("argon2id"),
    memory: Schema.Int.pipe(Schema.positive()),
    iterations: Schema.Int.pipe(Schema.positive()),
    parallelism: Schema.Int.pipe(Schema.positive()),
    hashLength: Schema.Int.pipe(Schema.positive()),
  }),
});

const ProfileChangePasswordSchema = Schema.Struct({
  profileId: NonEmptyString,
  wrappedRootKey: NonEmptyString,
  kdfSalt: NonEmptyString,
  kdfParams: Schema.Struct({
    algorithm: Schema.Literal("argon2id"),
    memory: Schema.Int.pipe(Schema.positive()),
    iterations: Schema.Int.pipe(Schema.positive()),
    parallelism: Schema.Int.pipe(Schema.positive()),
    hashLength: Schema.Int.pipe(Schema.positive()),
  }),
});

const ProfileSetupRecoverySchema = Schema.Struct({
  profileId: NonEmptyString,
  recoveryWrappedRootKey: NonEmptyString,
});

const ProfileRotateKeySchema = Schema.Struct({
  profileId: NonEmptyString,
  wrappedRootKey: NonEmptyString,
  recoveryWrappedRootKey: Schema.optional(Schema.String),
  rekeyedItems: Schema.Record({ key: Schema.String, value: NonEmptyString }),
});

/** Loads a profile and verifies the caller is a member of its org. Throws if not found or not a member. */
const loadProfile = (profileId: string, userId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;

    const [profile] = yield* tryAsync(() =>
      ctx.db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1),
    );

    if (!profile) {
      return yield* Effect.fail(
        new NotFoundError({
          code: "PROFILE_NOT_FOUND",
          message: "Profile not found",
          hint: "Check the profile ID and make sure it belongs to your organization.",
        }),
      );
    }

    yield* tryAsync(() => requireOrgRole(ctx.db, profile.organizationId, userId, "member"));

    return profile;
  });

/** Like loadProfile but requires admin role — use for destructive key operations. */
const loadProfileForWrite = (profileId: string, userId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;

    const [profile] = yield* tryAsync(() =>
      ctx.db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1),
    );

    if (!profile) {
      return yield* Effect.fail(
        new NotFoundError({
          code: "PROFILE_NOT_FOUND",
          message: "Profile not found",
          hint: "Check the profile ID and make sure it belongs to your organization.",
        }),
      );
    }

    yield* tryAsync(() => requireOrgRole(ctx.db, profile.organizationId, userId, "admin"));

    return profile;
  });

const createProfile = (input: Schema.Schema.Type<typeof CreateProfileSchema>) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const { orgId, name, description, storageMode } = input;
    const userId = ctx.identity.userId;

    yield* tryAsync(() => requireOrgRole(ctx.db, orgId, userId, "admin"));

    const id = crypto.randomUUID();
    const now = new Date();

    yield* tryAsync(() =>
      ctx.db.insert(profiles).values({
        id,
        organizationId: orgId,
        name,
        description: description ?? null,
        storageMode,
        createdAt: now,
        updatedAt: now,
      }),
    );

    const [created] = yield* tryAsync(() =>
      ctx.db.select().from(profiles).where(eq(profiles.id, id)).limit(1),
    );

    if (!created) {
      return yield* Effect.fail(
        new NotFoundError({
          code: "PROFILE_NOT_FOUND",
          message: "Profile not found after creation",
          hint: "An unexpected error occurred. Retry the request.",
        }),
      );
    }

    yield* logSessionAudit({
      organizationId: orgId,
      userId: ctx.identity.userId,
      profileId: id,
      eventType: "profile.create",
      result: "allowed",
      ipAddress: ctx.ipAddress,
    });

    return { profile: serializeProfile(created) };
  });

const listProfiles = (orgId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;

    yield* tryAsync(() => requireOrgRole(ctx.db, orgId, ctx.identity.userId, "member"));

    const rows = yield* tryAsync(() =>
      ctx.db.select().from(profiles).where(eq(profiles.organizationId, orgId)),
    );

    return { profiles: rows.map(serializeProfile) };
  });

const getProfile = (profileId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const profile = yield* loadProfile(profileId, ctx.identity.userId);
    return { profile: serializeProfile(profile) };
  });

const bootstrapProfile = (input: Schema.Schema.Type<typeof ProfileBootstrapSchema>) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const { profileId, wrappedRootKey, kdfSalt, kdfParams } = input;
    const userId = ctx.identity.userId;

    const profile = yield* loadProfileForWrite(profileId, userId);

    if (profile.wrappedRootKey) {
      return yield* Effect.fail(
        new ConflictError({
          code: "PROFILE_ALREADY_EXISTS",
          message: "Profile is already bootstrapped",
          hint: "Use changePassword to rotate the key, not bootstrap.",
        }),
      );
    }

    yield* tryAsync(() =>
      ctx.db
        .update(profiles)
        .set({
          wrappedRootKey,
          kdfSalt,
          kdfParams: kdfParams as unknown as KdfParams,
          updatedAt: new Date(),
        })
        .where(eq(profiles.id, profileId)),
    );

    yield* logSessionAudit({
      organizationId: profile.organizationId,
      userId,
      eventType: "profile.create",
      result: "allowed",
      ipAddress: ctx.ipAddress,
      meta: { profileId, orgId: profile.organizationId },
    });

    return { ok: true };
  });

const changeProfilePassword = (input: Schema.Schema.Type<typeof ProfileChangePasswordSchema>) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const { profileId, wrappedRootKey, kdfSalt, kdfParams } = input;
    const userId = ctx.identity.userId;

    const profile = yield* loadProfileForWrite(profileId, userId);

    if (!profile.wrappedRootKey) {
      return yield* Effect.fail(
        new NotFoundError({
          code: "PROFILE_NOT_FOUND",
          message: "Profile is not bootstrapped",
          hint: "Bootstrap the profile before changing the password.",
        }),
      );
    }

    yield* tryAsync(() =>
      ctx.db
        .update(profiles)
        .set({
          wrappedRootKey,
          kdfSalt,
          kdfParams: kdfParams as unknown as KdfParams,
          updatedAt: new Date(),
        })
        .where(eq(profiles.id, profileId)),
    );

    yield* logSessionAudit({
      organizationId: profile.organizationId,
      userId,
      eventType: "profile.rotate",
      result: "allowed",
      ipAddress: ctx.ipAddress,
      meta: { profileId },
    });

    return { ok: true };
  });

const setupProfileRecovery = (input: Schema.Schema.Type<typeof ProfileSetupRecoverySchema>) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const { profileId, recoveryWrappedRootKey } = input;

    const profile = yield* loadProfileForWrite(profileId, ctx.identity.userId);

    if (!profile.wrappedRootKey) {
      return yield* Effect.fail(
        new NotFoundError({
          code: "PROFILE_NOT_FOUND",
          message: "Profile is not bootstrapped",
          hint: "Bootstrap the profile before configuring a recovery key.",
        }),
      );
    }

    yield* tryAsync(() =>
      ctx.db
        .update(profiles)
        .set({ recoveryWrappedRootKey, updatedAt: new Date() })
        .where(eq(profiles.id, profileId)),
    );

    yield* logSessionAudit({
      organizationId: profile.organizationId,
      userId: ctx.identity.userId,
      profileId,
      eventType: "profile.setup_recovery",
      result: "allowed",
      ipAddress: ctx.ipAddress,
    });

    return { ok: true };
  });

const rotateProfileKey = (input: Schema.Schema.Type<typeof ProfileRotateKeySchema>) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const { profileId, wrappedRootKey, recoveryWrappedRootKey, rekeyedItems } = input;
    const userId = ctx.identity.userId;

    const profile = yield* loadProfileForWrite(profileId, userId);

    if (!profile.wrappedRootKey) {
      return yield* Effect.fail(
        new NotFoundError({
          code: "PROFILE_NOT_FOUND",
          message: "Profile is not bootstrapped",
          hint: "Bootstrap the profile before rotating keys.",
        }),
      );
    }

    const nextKeyVersion = profile.keyVersion + 1;

    yield* tryAsync(() =>
      ctx.db.transaction(async (tx) => {
        await tx
          .update(profiles)
          .set({
            wrappedRootKey,
            recoveryWrappedRootKey: recoveryWrappedRootKey ?? profile.recoveryWrappedRootKey,
            keyVersion: nextKeyVersion,
            updatedAt: new Date(),
          })
          .where(eq(profiles.id, profileId));

        for (const [itemId, newEncryptedItemKey] of Object.entries(rekeyedItems)) {
          await tx
            .update(items)
            .set({ encryptedItemKey: newEncryptedItemKey, updatedAt: new Date() })
            .where(and(eq(items.id, itemId), eq(items.profileId, profileId)));
        }
      }),
    );

    yield* logSessionAudit({
      organizationId: profile.organizationId,
      userId,
      eventType: "profile.rotate",
      result: "allowed",
      ipAddress: ctx.ipAddress,
      meta: { profileId, itemCount: Object.keys(rekeyedItems).length },
    });

    return { ok: true, keyVersion: nextKeyVersion };
  });

const deleteProfile = (profileId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const userId = ctx.identity.userId;

    const profile = yield* loadProfileForWrite(profileId, userId);

    const activeItems = yield* tryAsync(() =>
      ctx.db
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.profileId, profileId), isNull(items.deletedAt)))
        .limit(1),
    );

    if (activeItems.length > 0) {
      return yield* Effect.fail(
        new ConflictError({
          code: "PROFILE_NOT_EMPTY",
          message: "Profile still has active items",
          hint: "Delete all items in this profile before deleting it.",
        }),
      );
    }

    yield* tryAsync(() => ctx.db.delete(profiles).where(eq(profiles.id, profileId)));

    yield* logSessionAudit({
      organizationId: profile.organizationId,
      userId,
      profileId,
      eventType: "profile.delete",
      result: "allowed",
      ipAddress: ctx.ipAddress,
    });

    return { ok: true };
  });

const KeyVersionResultSchema = Schema.Struct({
  ok: Schema.Boolean,
  keyVersion: Schema.Int.pipe(Schema.positive()),
});

export const profilesRouter = createTrpcRouter({
  create: sessionProcedure
    .input(strictSchema(CreateProfileSchema))
    .output(strictSchema(ProfileResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, createProfile(input))),

  list: sessionProcedure
    .input(strictSchema(OrgIdSchema))
    .output(strictSchema(ProfileListResultSchema))
    .query(({ ctx, input }) => runSessionEffect(ctx, listProfiles(input.orgId))),

  get: sessionProcedure
    .input(strictSchema(ProfileIdSchema))
    .output(strictSchema(ProfileResultSchema))
    .query(({ ctx, input }) => runSessionEffect(ctx, getProfile(input.profileId))),

  bootstrap: sessionProcedure
    .input(strictSchema(ProfileBootstrapSchema))
    .output(strictSchema(SuccessResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, bootstrapProfile(input))),

  changePassword: sessionProcedure
    .input(strictSchema(ProfileChangePasswordSchema))
    .output(strictSchema(SuccessResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, changeProfilePassword(input))),

  setupRecovery: sessionProcedure
    .input(strictSchema(ProfileSetupRecoverySchema))
    .output(strictSchema(SuccessResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, setupProfileRecovery(input))),

  rotateKey: sessionProcedure
    .input(strictSchema(ProfileRotateKeySchema))
    .output(strictSchema(KeyVersionResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, rotateProfileKey(input))),

  delete: sessionProcedure
    .input(strictSchema(ProfileIdSchema))
    .output(strictSchema(SuccessResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, deleteProfile(input.profileId))),
});

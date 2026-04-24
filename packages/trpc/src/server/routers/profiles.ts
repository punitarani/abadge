import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  type KdfParams,
  NotFoundError,
  ProfileListResultSchema,
  ProfileResultSchema,
  RekeyedItemSchema,
  SuccessResultSchema,
} from "@abadge/core";
import { and, eq, isNull, sql } from "@abadge/db";
import { items, profiles } from "@abadge/db/schema";
import { Effect, Schema } from "effect";
import { auditDeniedSession, logSessionAudit } from "../audit";
import {
  isUniqueViolation,
  runSessionEffect,
  SessionRequestContextTag,
  strictSchema,
  tryAsync,
} from "../effect";
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
  rekeyedItems: Schema.Array(RekeyedItemSchema),
});

/** Loads a profile and verifies the caller is a member of its org. Throws if not found or not a member. */
const loadProfile = (
  profileId: string,
  userId: string,
  eventType:
    | "profile.read"
    | "profile.create"
    | "profile.delete"
    | "profile.bootstrap"
    | "profile.rotate"
    | "profile.setup_recovery",
) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;

    const [profile] = yield* tryAsync(() =>
      ctx.db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1),
    );

    if (!profile) {
      return yield* auditDeniedSession(
        {
          organizationId: ctx.identity.organizationId,
          userId,
          profileId,
          eventType,
          reason: "not_found",
          ipAddress: ctx.ipAddress,
        },
        new NotFoundError({
          code: "PROFILE_NOT_FOUND",
          message: "Profile not found",
          hint: "Check the profile ID and make sure it belongs to your organization.",
        }),
      );
    }

    yield* tryAsync(() => requireOrgRole(ctx.db, profile.organizationId, userId, "member")).pipe(
      Effect.tapError((err) =>
        err instanceof ForbiddenError
          ? logSessionAudit({
              organizationId: ctx.identity.organizationId,
              userId,
              profileId,
              eventType,
              result: "denied",
              ipAddress: ctx.ipAddress,
              meta: { reason: "insufficient_role" },
            })
          : Effect.void,
      ),
    );

    return profile;
  });

/** Like loadProfile but requires admin role — use for destructive key operations. */
const loadProfileForWrite = (
  profileId: string,
  userId: string,
  eventType:
    | "profile.create"
    | "profile.delete"
    | "profile.bootstrap"
    | "profile.rotate"
    | "profile.setup_recovery",
) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;

    const [profile] = yield* tryAsync(() =>
      ctx.db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1),
    );

    if (!profile) {
      return yield* auditDeniedSession(
        {
          organizationId: ctx.identity.organizationId,
          userId,
          profileId,
          eventType,
          reason: "not_found",
          ipAddress: ctx.ipAddress,
        },
        new NotFoundError({
          code: "PROFILE_NOT_FOUND",
          message: "Profile not found",
          hint: "Check the profile ID and make sure it belongs to your organization.",
        }),
      );
    }

    yield* tryAsync(() => requireOrgRole(ctx.db, profile.organizationId, userId, "admin")).pipe(
      Effect.tapError((err) =>
        err instanceof ForbiddenError
          ? logSessionAudit({
              organizationId: ctx.identity.organizationId,
              userId,
              profileId,
              eventType,
              result: "denied",
              ipAddress: ctx.ipAddress,
              meta: { reason: "insufficient_role" },
            })
          : Effect.void,
      ),
    );

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
    ).pipe(
      Effect.catchIf(
        (e: Error) => isUniqueViolation(e),
        () =>
          Effect.fail(
            new ConflictError({
              code: "PROFILE_ALREADY_EXISTS",
              message: `A profile named '${name}' already exists in this organization`,
              hint: "Choose a different name or delete the existing profile.",
            }),
          ),
      ),
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
    const profile = yield* loadProfile(profileId, ctx.identity.userId, "profile.read");
    return { profile: serializeProfile(profile) };
  });

const bootstrapProfile = (input: Schema.Schema.Type<typeof ProfileBootstrapSchema>) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const { profileId, wrappedRootKey, kdfSalt, kdfParams } = input;
    const userId = ctx.identity.userId;

    // Ownership gate: throws PROFILE_NOT_FOUND if the profile does not exist
    // or the caller is not an admin of its org. Must run before the UPDATE so
    // an un-bootstrapped profile in a foreign org cannot be hijacked.
    const profile = yield* loadProfileForWrite(profileId, userId, "profile.bootstrap");

    // Atomic UPDATE: the `isNull(wrappedRootKey)` guard handles both the
    // sequential case (already bootstrapped) and the concurrent case (two
    // callers race past the SELECT above). The loser sees 0 rows in RETURNING
    // and gets PROFILE_ALREADY_EXISTS; no silent overwrite.
    const updated = yield* tryAsync(() =>
      ctx.db
        .update(profiles)
        .set({
          wrappedRootKey,
          kdfSalt,
          kdfParams: kdfParams as unknown as KdfParams,
          updatedAt: new Date(),
        })
        .where(and(eq(profiles.id, profileId), isNull(profiles.wrappedRootKey)))
        .returning({ id: profiles.id }),
    );

    if (updated.length === 0) {
      return yield* Effect.fail(
        new ConflictError({
          code: "PROFILE_ALREADY_EXISTS",
          message: "Profile is already bootstrapped",
          hint: "Use changePassword to rotate the key, not bootstrap.",
        }),
      );
    }

    yield* logSessionAudit({
      organizationId: profile.organizationId,
      userId,
      eventType: "profile.bootstrap",
      result: "allowed",
      ipAddress: ctx.ipAddress,
      meta: { profileId, orgId: profile.organizationId },
    });

    return { ok: true };
  });

const changeProfilePassword = (input: Schema.Schema.Type<typeof ProfileChangePasswordSchema>) =>
  // TODO(§W1S7-001-followup): changePassword does NOT advance profile.keyVersion,
  // but a concurrent rotateKey could commit between the client's `profiles.get`
  // (which reads keyVersion for the AAD bind) and this UPDATE. Post-AAD the
  // mismatch fails loudly on the next unlock rather than silently. Adding a
  // CAS on profile.keyVersion here would tighten that to a synchronous
  // CONFLICT — out of scope for the AAD fix itself.
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const { profileId, wrappedRootKey, kdfSalt, kdfParams } = input;
    const userId = ctx.identity.userId;

    const profile = yield* loadProfileForWrite(profileId, userId, "profile.rotate");

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

    const profile = yield* loadProfileForWrite(
      profileId,
      ctx.identity.userId,
      "profile.setup_recovery",
    );

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

    const profile = yield* loadProfileForWrite(profileId, userId, "profile.rotate");

    if (!profile.wrappedRootKey) {
      return yield* Effect.fail(
        new NotFoundError({
          code: "PROFILE_NOT_FOUND",
          message: "Profile is not bootstrapped",
          hint: "Bootstrap the profile before rotating keys.",
        }),
      );
    }

    // Coverage check + updates run in a single tx so a concurrent items.create
    // between SELECT and UPDATE cannot bypass rewrapping (TOCTOU).
    // Throwing the domain error inside the tx triggers rollback; tryAsync's
    // catch preserves the Error instance, and toTrpcError maps it by isDomainError.
    const nextKeyVersion = yield* tryAsync(() =>
      ctx.db.transaction(async (tx) => {
        // Serialize with concurrent items.create on the same profile (§I5-RACE).
        // Raw SQL because pg_advisory_xact_lock is not expressible in Drizzle's typed API.
        // The lock is released automatically on txn commit/rollback.
        // pg_advisory_xact_lock takes a single int; hashtext(uuid) collapses UUIDs into 32 bits.
        // Collisions are rare (<0.1% for 10K profiles) and benign — two unrelated profiles
        // occasionally serialize. Acceptable perf cost; correctness is unaffected.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${profileId}))`);

        // Re-read keyVersion + recoveryWrappedRootKey UNDER the lock. Defense against a rotate
        // that committed between loadProfileForWrite and the lock acquisition.
        const [locked] = await tx
          .select({
            keyVersion: profiles.keyVersion,
            wrappedRootKey: profiles.wrappedRootKey,
            recoveryWrappedRootKey: profiles.recoveryWrappedRootKey,
          })
          .from(profiles)
          .where(eq(profiles.id, profileId));

        if (!locked || !locked.wrappedRootKey) {
          throw new NotFoundError({
            code: "PROFILE_NOT_FOUND",
            message: "Profile is not bootstrapped",
            hint: "Bootstrap the profile before rotating keys.",
          });
        }

        const txNextKeyVersion = locked.keyVersion + 1;

        const zkItemsInProfile = await tx
          .select({ id: items.id })
          .from(items)
          .where(
            and(
              eq(items.profileId, profileId),
              eq(items.storageMode, "zero_knowledge"),
              isNull(items.deletedAt),
            ),
          );

        const providedIds = new Set(rekeyedItems.map((r) => r.itemId));
        const missing = zkItemsInProfile.filter((row) => !providedIds.has(row.id));
        if (missing.length > 0) {
          throw new BadRequestError({
            code: "ROTATE_KEY_INCOMPLETE",
            message: `Rotate payload missing ${missing.length} ZK item(s) in this profile`,
            hint: "Client must rewrap every ZK item in the profile before rotating.",
            meta: { missingItemIds: missing.map((row) => row.id) },
          });
        }

        // Belt-and-suspenders CAS on the UPDATE — the advisory lock already serializes
        // concurrent rotates, but the explicit keyVersion check documents the invariant
        // and protects against any future refactor that loses the lock.
        const updated = await tx
          .update(profiles)
          .set({
            wrappedRootKey,
            recoveryWrappedRootKey: recoveryWrappedRootKey ?? locked.recoveryWrappedRootKey,
            keyVersion: txNextKeyVersion,
            updatedAt: new Date(),
          })
          .where(and(eq(profiles.id, profileId), eq(profiles.keyVersion, locked.keyVersion)))
          .returning({ id: profiles.id });

        if (updated.length === 0) {
          throw new ConflictError({
            code: "CONFLICT",
            message: "Profile keyVersion advanced during rotate",
            hint: "Another rotation committed concurrently. Refresh and retry.",
          });
        }

        // Persist encryptedItemKey — the nonce is prepended inside the combined blob.
        // Extra ids not in the profile are filtered by the WHERE clause (no-op) rather than rejected,
        // so concurrent deletes don't race the rotate.
        for (const r of rekeyedItems) {
          await tx
            .update(items)
            .set({
              encryptedItemKey: r.encryptedItemKey,
              cryptoVersion: txNextKeyVersion,
              updatedAt: new Date(),
            })
            .where(and(eq(items.id, r.itemId), eq(items.profileId, profileId)));
        }

        return txNextKeyVersion;
      }),
    );

    yield* logSessionAudit({
      organizationId: profile.organizationId,
      userId,
      eventType: "profile.rotate",
      result: "allowed",
      ipAddress: ctx.ipAddress,
      meta: { profileId, itemCount: rekeyedItems.length },
    });

    return { ok: true, keyVersion: nextKeyVersion };
  });

const deleteProfile = (profileId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const userId = ctx.identity.userId;

    const profile = yield* loadProfileForWrite(profileId, userId, "profile.delete");

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

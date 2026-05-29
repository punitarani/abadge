import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  isPersonalOrg,
  type KdfParams,
  NotFoundError,
  ProfileListResultSchema,
  ProfileResultSchema,
  RekeyedItemSchema,
  SuccessResultSchema,
} from "@abadge/core";
import { and, eq, isNull, sql, type Transaction } from "@abadge/db";
import { organization } from "@abadge/db/schema";
import { Effect, Schema } from "effect";
import { auditDeniedSession, logSessionAudit } from "../audit";
import {
  isUniqueViolation,
  runSessionEffect,
  SessionRequestContextTag,
  strictSchema,
  tryAsync,
} from "../effect";
import { createTrpcRouter, requireOrgRole, scopedSessionProcedure } from "../init";
import { scopedDb } from "../scoped-db";
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
  // §REVAMP-PR5 — optional, stable, customer-supplied identifier.
  // Scoped per-org via the partial-unique index added in PR1; NULL means
  // "no external id" and is always allowed.
  externalId: Schema.optional(Schema.String),
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

    // Use scopedDb.findFirst so the org filter is baked in: a profileId from a
    // different org returns undefined (same "not found" path) rather than a
    // different error shape that would reveal the profileId exists in another org.
    const scope = scopedDb(ctx.db, ctx.identity.organizationId);
    const profile = yield* tryAsync(() =>
      scope.findFirst("profiles", { where: eq(scope.tables.profiles.id, profileId) }),
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
    const scope = scopedDb(ctx.db, ctx.identity.organizationId);

    const profile = yield* tryAsync(() =>
      scope.findFirst("profiles", { where: eq(scope.tables.profiles.id, profileId) }),
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

/**
 * Personal accounts are capped at a single profile. For a personal org this
 * takes a per-org advisory lock (serializing concurrent creates across
 * transactions, the same idiom rotateProfileKey uses) and rejects when a
 * profile already exists. Must run inside the create transaction so the check
 * and the subsequent insert are atomic. `organization` is a Better-Auth table
 * (not RLS-scoped), so reading its metadata inside the org tx is safe. No-op
 * for team orgs. The cap is "at most one" — an existence check, not a blanket
 * block — so a personal account whose only profile was deleted can recreate
 * exactly one.
 */
const assertPersonalProfileCap = async (tx: Transaction, orgId: string): Promise<void> => {
  const [org] = await tx
    .select({ metadata: organization.metadata })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);
  if (!isPersonalOrg(org?.metadata)) return;

  // Serialize concurrent creates for THIS org so the existence check + insert
  // are atomic across transactions. The two-arg form yields a 64-bit key space
  // (two int4 hashes of the orgId halves) rather than the single-arg 32-bit
  // hashtext, so unrelated orgs don't collide onto the same lock and block each
  // other. Released automatically on transaction commit/rollback.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(left(${orgId}, 16)), hashtext(right(${orgId}, 16)))`,
  );
  const existing = await scopedDb(tx, orgId).findFirst("profiles");
  if (existing) {
    throw new ConflictError({
      code: "PROFILE_LIMIT_EXCEEDED",
      message: "Personal accounts are limited to a single profile",
      hint: "Delete the existing profile before creating a new one, or create a team organization for multiple profiles.",
    });
  }
};

const createProfile = (input: Schema.Schema.Type<typeof CreateProfileSchema>) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const { orgId, name, description, externalId, storageMode } = input;
    const userId = ctx.identity.userId;

    yield* tryAsync(() => requireOrgRole(ctx.db, orgId, userId, "admin"));

    const id = crypto.randomUUID();
    const now = new Date();

    // The personal-account cap check and the insert run in one transaction so a
    // concurrent create cannot slip a second profile past the check (TOCTOU).
    // Throwing a domain error inside the tx rolls it back; tryAsync preserves
    // the instance for toTrpcError to map.
    const created = yield* tryAsync(() =>
      ctx.db.transaction(async (tx) => {
        const txScope = scopedDb(tx, orgId);
        await assertPersonalProfileCap(tx, orgId);

        try {
          await txScope.insert("profiles", {
            id,
            name,
            externalId: externalId ?? null,
            description: description ?? null,
            storageMode,
            createdAt: now,
            updatedAt: now,
          });
        } catch (e) {
          if (isUniqueViolation(e as Error)) {
            throw new ConflictError({
              code: "PROFILE_ALREADY_EXISTS",
              message: `A profile named '${name}' already exists in this organization`,
              hint: "Choose a different name or delete the existing profile.",
            });
          }
          throw e;
        }

        return txScope.findFirst("profiles", { where: eq(txScope.tables.profiles.id, id) });
      }),
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

    const rows = yield* tryAsync(() => scopedDb(ctx.db, orgId).findMany("profiles"));

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
    const scope = scopedDb(ctx.db, profile.organizationId);
    const updated = yield* tryAsync(() =>
      scope.executor
        .update(scope.tables.profiles)
        .set({
          wrappedRootKey,
          kdfSalt,
          kdfParams: kdfParams as unknown as KdfParams,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(scope.tables.profiles.id, profileId),
            isNull(scope.tables.profiles.wrappedRootKey),
            scope.orgScope("profiles"),
          ),
        )
        .returning({ id: scope.tables.profiles.id }),
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

    const scope = scopedDb(ctx.db, profile.organizationId);
    yield* tryAsync(() =>
      scope.executor
        .update(scope.tables.profiles)
        .set({
          wrappedRootKey,
          kdfSalt,
          kdfParams: kdfParams as unknown as KdfParams,
          updatedAt: new Date(),
        })
        .where(and(eq(scope.tables.profiles.id, profileId), scope.orgScope("profiles"))),
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

    const scope = scopedDb(ctx.db, profile.organizationId);
    yield* tryAsync(() =>
      scope.executor
        .update(scope.tables.profiles)
        .set({ recoveryWrappedRootKey, updatedAt: new Date() })
        .where(and(eq(scope.tables.profiles.id, profileId), scope.orgScope("profiles"))),
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
        const txScope = scopedDb(tx, profile.organizationId);
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
            keyVersion: txScope.tables.profiles.keyVersion,
            wrappedRootKey: txScope.tables.profiles.wrappedRootKey,
            recoveryWrappedRootKey: txScope.tables.profiles.recoveryWrappedRootKey,
          })
          .from(txScope.tables.profiles)
          .where(and(eq(txScope.tables.profiles.id, profileId), txScope.orgScope("profiles")));

        if (!locked?.wrappedRootKey) {
          throw new NotFoundError({
            code: "PROFILE_NOT_FOUND",
            message: "Profile is not bootstrapped",
            hint: "Bootstrap the profile before rotating keys.",
          });
        }

        const txNextKeyVersion = locked.keyVersion + 1;

        const zkItemsInProfile = await tx
          .select({ id: txScope.tables.items.id })
          .from(txScope.tables.items)
          .where(
            and(
              txScope.orgScope("items"),
              eq(txScope.tables.items.profileId, profileId),
              eq(txScope.tables.items.storageMode, "zero_knowledge"),
              isNull(txScope.tables.items.deletedAt),
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
          .update(txScope.tables.profiles)
          .set({
            wrappedRootKey,
            recoveryWrappedRootKey: recoveryWrappedRootKey ?? locked.recoveryWrappedRootKey,
            keyVersion: txNextKeyVersion,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(txScope.tables.profiles.id, profileId),
              eq(txScope.tables.profiles.keyVersion, locked.keyVersion),
              txScope.orgScope("profiles"),
            ),
          )
          .returning({ id: txScope.tables.profiles.id });

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
            .update(txScope.tables.items)
            .set({
              encryptedItemKey: r.encryptedItemKey,
              cryptoVersion: txNextKeyVersion,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(txScope.tables.items.id, r.itemId),
                eq(txScope.tables.items.profileId, profileId),
                txScope.orgScope("items"),
              ),
            );
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

    const scope = scopedDb(ctx.db, profile.organizationId);
    const activeItems = yield* tryAsync(() =>
      scope.executor
        .select({ id: scope.tables.items.id })
        .from(scope.tables.items)
        .where(
          and(
            scope.orgScope("items"),
            eq(scope.tables.items.profileId, profileId),
            isNull(scope.tables.items.deletedAt),
          ),
        )
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

    // §RM-PR2 — Before deleting the profile, snapshot every permission
    // targeting it so we can write one permission.revoke_cascade audit row
    // per implicitly-invalidated grant. The DB ON DELETE CASCADE handles
    // the actual row removal; the audit table has no FK so the rows survive.
    // All three steps land in a single transaction so a deleted-without-audit
    // state is unreachable.
    yield* tryAsync(() =>
      ctx.db.transaction(async (tx) => {
        const txScope = scopedDb(tx, profile.organizationId);
        const grants = await tx
          .select({
            id: txScope.tables.permissions.id,
            agentId: txScope.tables.permissions.agentId,
            capability: txScope.tables.permissions.capability,
          })
          .from(txScope.tables.permissions)
          .where(
            and(
              txScope.orgScope("permissions"),
              eq(txScope.tables.permissions.profileId, profileId),
            ),
          );

        if (grants.length > 0) {
          await tx.insert(txScope.tables.auditLogs).values(
            grants.map((g) => ({
              organizationId: profile.organizationId,
              userId,
              agentId: g.agentId,
              profileId,
              eventType: "permission.revoke_cascade" as const,
              result: "cascade" as const,
              meta: {
                reason: "profile_deleted",
                permissionId: g.id,
                agentId: g.agentId,
                capability: g.capability,
              },
              ipAddress: ctx.ipAddress ?? null,
            })),
          );
        }

        await tx
          .delete(txScope.tables.profiles)
          .where(and(eq(txScope.tables.profiles.id, profileId), txScope.orgScope("profiles")));
      }),
    );

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
  create: scopedSessionProcedure("profiles")
    .meta({
      openapi: {
        method: "POST",
        path: "/orgs/{orgId}/profiles",
        tags: ["profiles"],
        protect: true,
      },
    })
    .input(strictSchema(CreateProfileSchema))
    .output(strictSchema(ProfileResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, createProfile(input))),

  list: scopedSessionProcedure("profiles")
    .meta({
      openapi: {
        method: "GET",
        path: "/orgs/{orgId}/profiles",
        tags: ["profiles"],
        protect: true,
      },
    })
    .input(strictSchema(OrgIdSchema))
    .output(strictSchema(ProfileListResultSchema))
    .query(({ ctx, input }) => runSessionEffect(ctx, listProfiles(input.orgId))),

  get: scopedSessionProcedure("profiles")
    .meta({
      openapi: {
        method: "GET",
        path: "/profiles/{profileId}",
        tags: ["profiles"],
        protect: true,
      },
    })
    .input(strictSchema(ProfileIdSchema))
    .output(strictSchema(ProfileResultSchema))
    .query(({ ctx, input }) => runSessionEffect(ctx, getProfile(input.profileId))),

  bootstrap: scopedSessionProcedure("profiles")
    .meta({
      openapi: {
        method: "POST",
        path: "/profiles/{profileId}/bootstrap",
        tags: ["profiles"],
        protect: true,
      },
    })
    .input(strictSchema(ProfileBootstrapSchema))
    .output(strictSchema(SuccessResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, bootstrapProfile(input))),

  changePassword: scopedSessionProcedure("profiles")
    .input(strictSchema(ProfileChangePasswordSchema))
    .output(strictSchema(SuccessResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, changeProfilePassword(input))),

  setupRecovery: scopedSessionProcedure("profiles")
    .input(strictSchema(ProfileSetupRecoverySchema))
    .output(strictSchema(SuccessResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, setupProfileRecovery(input))),

  rotateKey: scopedSessionProcedure("profiles")
    .meta({
      openapi: {
        method: "POST",
        path: "/profiles/{profileId}/rotate",
        tags: ["profiles"],
        protect: true,
      },
    })
    .input(strictSchema(ProfileRotateKeySchema))
    .output(strictSchema(KeyVersionResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, rotateProfileKey(input))),

  delete: scopedSessionProcedure("profiles")
    .meta({
      openapi: {
        method: "DELETE",
        path: "/profiles/{profileId}",
        tags: ["profiles"],
        protect: true,
      },
    })
    .input(strictSchema(ProfileIdSchema))
    .output(strictSchema(SuccessResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, deleteProfile(input.profileId))),
});

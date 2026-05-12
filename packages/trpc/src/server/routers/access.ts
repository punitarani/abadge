import type {
  BulkMountEnvInput,
  BulkMountEnvItem,
  Capability,
  CiphertextAccessInput,
  ItemPayload,
  MountAccessInput,
  RevealAccessInput,
} from "@abadge/core";
import {
  BadRequestError,
  BulkMountEnvResponseSchema,
  BulkMountEnvSchema,
  CiphertextAccessResponseSchema,
  CiphertextAccessSchema,
  FieldNotFoundError,
  ForbiddenError,
  IntegrityError,
  MountAccessResponseSchema,
  MountAccessSchema,
  MultiFieldItemError,
  NotFoundError,
  ProfileUseAccessSchema,
  ReadAccessResponseSchema,
  ReadAccessSchema,
  RevealAccessResponseSchema,
  RevealAccessSchema,
  resolveFieldValue,
  UseAccessResponseSchema,
  UseAccessSchema,
} from "@abadge/core";
import { serverDecrypt } from "@abadge/crypto/server";
import {
  profileIdForServerAad,
  SERVER_AAD_MIN_VERSION,
  type ServerAadMeta,
} from "@abadge/crypto/shared";
import { and, eq, gt, isNull, or } from "@abadge/db";
import {
  items,
  permissions as permissionRecords,
  profiles as profileRecords,
} from "@abadge/db/schema";
import { Cause, Effect, Schema } from "effect";
import { logAgentAudit } from "../audit";
import { AgentRequestContextTag, runAgentEffect, strictSchema, tryAsync } from "../effect";
import { agentProcedure, createTrpcRouter } from "../init";
import { decodeServerManagedPayload } from "../item-payload";
import { resolveAccess, resolveProfileAccess } from "./access/pipeline";

function permissionDeniedError(result: "denied" | "expired", defaultHint: string): ForbiddenError {
  if (result === "expired") {
    return new ForbiddenError({
      code: "PERMISSION_EXPIRED",
      message: "Permission has expired",
      hint: "Renew the permission or request a new grant before retrying.",
    });
  }
  return new ForbiddenError({
    code: "PERMISSION_DENIED",
    message: "No valid permission",
    hint: defaultHint,
  });
}

const failMissingServerManagedData = (
  itemId: string,
  eventType: "access.reveal" | "access.mount_env" | "access.mount_file",
) =>
  Effect.gen(function* () {
    const ctx = yield* AgentRequestContextTag;

    yield* logAgentAudit({
      organizationId: ctx.identity.agentOrganizationId,
      userId: ctx.identity.agentUserId,
      agentId: ctx.identity.agentId,
      itemId,
      eventType,
      result: "denied",
      ipAddress: ctx.ipAddress,
      meta: { reason: "item has no server-encrypted data" },
    });

    return yield* Effect.fail(
      new IntegrityError({
        code: "INTEGRITY_ERROR",
        message: "Server-managed item has no encrypted payload",
        hint: "This item may need to be re-created; contact support if this persists.",
        meta: { itemId },
      }),
    );
  });

const decryptServerManagedItem = (
  item: typeof items.$inferSelect,
  eventType: "access.reveal" | "access.mount_env" | "access.mount_file",
) =>
  Effect.gen(function* () {
    const ctx = yield* AgentRequestContextTag;

    if (!item.serverCiphertext || !item.serverIv || item.serverKeyVersion == null) {
      return yield* failMissingServerManagedData(item.id, eventType);
    }

    const ciphertext = item.serverCiphertext;
    const iv = item.serverIv;
    const keyVersion = item.serverKeyVersion;

    // v1 rows predate AAD binding and MUST be decrypted without AAD.
    // v2+ rows carry AAD bound to (orgId, profileId, itemId, keyVersion),
    // so a DB-write adversary cannot substitute rows across items.
    const aadMeta: ServerAadMeta | undefined =
      keyVersion >= SERVER_AAD_MIN_VERSION
        ? {
            orgId: ctx.identity.agentOrganizationId,
            profileId: profileIdForServerAad(item.profileId),
            itemId: item.id,
            keyVersion,
          }
        : undefined;

    return yield* tryAsync(() =>
      serverDecrypt(
        {
          ciphertext,
          iv,
          keyVersion,
        },
        ctx.env.ENCRYPTION_KEY,
        aadMeta,
      ),
    );
  });

const checkPermission = (agentId: string, itemId: string, capability: Capability) =>
  Effect.gen(function* () {
    const ctx = yield* AgentRequestContextTag;
    const [permission] = yield* tryAsync(() =>
      ctx.db
        .select()
        .from(permissionRecords)
        .where(
          and(
            eq(permissionRecords.agentId, agentId),
            eq(permissionRecords.itemId, itemId),
            eq(permissionRecords.capability, capability),
          ),
        )
        .limit(1),
    );

    if (!permission) {
      return "denied" as const;
    }

    if (permission.expiresAt && permission.expiresAt < new Date()) {
      return "expired" as const;
    }

    return "allowed" as const;
  });

const loadAccessibleItem = (itemId: string) =>
  Effect.gen(function* () {
    const ctx = yield* AgentRequestContextTag;
    const [item] = yield* tryAsync(() =>
      ctx.db
        .select()
        .from(items)
        .where(
          and(
            eq(items.id, itemId),
            eq(items.organizationId, ctx.identity.agentOrganizationId),
            isNull(items.deletedAt),
          ),
        )
        .limit(1),
    );

    if (!item) {
      return yield* Effect.fail(
        new NotFoundError({
          code: "ITEM_NOT_FOUND",
          message: "Item not found",
          hint: "Check the item ID and confirm the agent belongs to the same organization.",
        }),
      );
    }

    return item;
  });

const accessCiphertext = (input: CiphertextAccessInput) =>
  Effect.gen(function* () {
    const ctx = yield* AgentRequestContextTag;

    if (ctx.identity.agentLocality !== "local") {
      yield* logAgentAudit({
        organizationId: ctx.identity.agentOrganizationId,
        userId: ctx.identity.agentUserId,
        agentId: ctx.identity.agentId,
        itemId: input.itemId,
        eventType: "access.ciphertext",
        result: "denied",
        ipAddress: ctx.ipAddress,
        meta: { reason: "remote agent cannot read ciphertext" },
      });

      return yield* Effect.fail(
        new ForbiddenError({
          code: "PERMISSION_DENIED",
          message: "Remote agents cannot access ciphertext",
          hint: "Use reveal_plaintext on a server-managed item or register a local agent.",
        }),
      );
    }

    const item = yield* loadAccessibleItem(input.itemId);
    if (item.storageMode !== "zero_knowledge") {
      yield* logAgentAudit({
        organizationId: ctx.identity.agentOrganizationId,
        userId: ctx.identity.agentUserId,
        agentId: ctx.identity.agentId,
        itemId: input.itemId,
        eventType: "access.ciphertext",
        result: "denied",
        ipAddress: ctx.ipAddress,
      });

      return yield* Effect.fail(
        new BadRequestError({
          code: "BAD_REQUEST",
          message: "Item is not zero-knowledge",
          hint: "Use reveal_plaintext for server-managed items instead of ciphertext access.",
        }),
      );
    }

    const permResult = yield* checkPermission(
      ctx.identity.agentId,
      input.itemId,
      "read_ciphertext",
    );
    if (permResult !== "allowed") {
      yield* logAgentAudit({
        organizationId: ctx.identity.agentOrganizationId,
        userId: ctx.identity.agentUserId,
        agentId: ctx.identity.agentId,
        itemId: input.itemId,
        eventType: "access.ciphertext",
        result: permResult,
        ipAddress: ctx.ipAddress,
      });

      return yield* Effect.fail(
        permissionDeniedError(
          permResult,
          "Grant read_ciphertext on this item to the agent before retrying.",
        ),
      );
    }

    // §W1S7-001 — local decrypt needs (itemId, profileId, contentVersion) to
    // rebuild the XChaCha20-Poly1305 AAD. Every ZK item must live inside a
    // ZK profile (insertZeroKnowledgeItem enforces this); a null profileId
    // here would mean a schema-level orphan, which would be undecryptable.
    if (!item.profileId) {
      yield* logAgentAudit({
        organizationId: ctx.identity.agentOrganizationId,
        userId: ctx.identity.agentUserId,
        agentId: ctx.identity.agentId,
        itemId: input.itemId,
        eventType: "access.ciphertext",
        result: "denied",
        ipAddress: ctx.ipAddress,
        meta: { reason: "zk item missing profileId" },
      });
      return yield* Effect.fail(
        new IntegrityError({
          code: "INTEGRITY_ERROR",
          message: "Zero-knowledge item is missing its profile binding",
          hint: "This indicates data corruption; contact support.",
          meta: { itemId: input.itemId },
        }),
      );
    }

    yield* logAgentAudit({
      organizationId: ctx.identity.agentOrganizationId,
      userId: ctx.identity.agentUserId,
      agentId: ctx.identity.agentId,
      itemId: input.itemId,
      eventType: "access.ciphertext",
      result: "allowed",
      ipAddress: ctx.ipAddress,
    });

    return {
      encryptedItemKey: item.encryptedItemKey ?? "",
      ciphertext: item.ciphertext ?? "",
      cryptoVersion: item.cryptoVersion,
      itemId: item.id,
      profileId: item.profileId,
      contentVersion: item.contentVersion,
    };
  });

/**
 * Run `resolveFieldValue` and, on field-resolution failure, emit a denied audit
 * row for the given access event type. Audit-write failures are swallowed so
 * they cannot mask the original domain error reaching the client.
 */
const resolveFieldOrDenyAudit = (
  payload: ItemPayload,
  field: string,
  audit: {
    itemId: string;
    eventType: "access.reveal" | "access.mount_env" | "access.mount_file";
    deliveryMode: "reveal" | "mount_env" | "mount_file";
    purpose?: string;
  },
): Effect.Effect<
  string,
  FieldNotFoundError | MultiFieldItemError | Cause.UnknownException,
  AgentRequestContextTag
> =>
  Effect.try({
    try: () => resolveFieldValue(payload, field),
    catch: (err) => {
      if (err instanceof FieldNotFoundError || err instanceof MultiFieldItemError) {
        return err;
      }
      return new Cause.UnknownException(err, "field resolution failed");
    },
  }).pipe(
    Effect.tapError((err) =>
      Effect.gen(function* () {
        if (!(err instanceof FieldNotFoundError) && !(err instanceof MultiFieldItemError)) {
          return;
        }
        const ctx = yield* AgentRequestContextTag;
        // Audit-write failures MUST NOT mask the primary domain error.
        yield* logAgentAudit({
          organizationId: ctx.identity.agentOrganizationId,
          userId: ctx.identity.agentUserId,
          agentId: ctx.identity.agentId,
          itemId: audit.itemId,
          eventType: audit.eventType,
          result: "denied",
          deliveryMode: audit.deliveryMode,
          field,
          purpose: audit.purpose,
          ipAddress: ctx.ipAddress,
          meta: {
            reason: err._tag,
            availableFields: err.meta?.availableFields ?? [],
          },
        }).pipe(Effect.catchAll(() => Effect.void));
      }),
    ),
  );

const accessReveal = (input: RevealAccessInput) =>
  Effect.gen(function* () {
    const ctx = yield* AgentRequestContextTag;
    const item = yield* loadAccessibleItem(input.itemId);

    if (item.storageMode !== "server_managed") {
      yield* logAgentAudit({
        organizationId: ctx.identity.agentOrganizationId,
        userId: ctx.identity.agentUserId,
        agentId: ctx.identity.agentId,
        itemId: input.itemId,
        eventType: "access.reveal",
        result: "denied",
        ipAddress: ctx.ipAddress,
      });

      return yield* Effect.fail(
        new BadRequestError({
          code: "BAD_REQUEST",
          message: "Cannot reveal zero-knowledge items via API",
          hint: "Use read_ciphertext for zero-knowledge items or choose a server-managed item.",
        }),
      );
    }

    const permResult = yield* checkPermission(
      ctx.identity.agentId,
      input.itemId,
      "reveal_plaintext",
    );
    if (permResult !== "allowed") {
      yield* logAgentAudit({
        organizationId: ctx.identity.agentOrganizationId,
        userId: ctx.identity.agentUserId,
        agentId: ctx.identity.agentId,
        itemId: input.itemId,
        eventType: "access.reveal",
        result: permResult,
        ipAddress: ctx.ipAddress,
      });

      return yield* Effect.fail(
        permissionDeniedError(
          permResult,
          "Grant reveal_plaintext on this item to the agent before retrying.",
        ),
      );
    }

    const decrypted = yield* decryptServerManagedItem(item, "access.reveal");
    const payload = decodeServerManagedPayload(item.id, decrypted);

    // Resolve field if specified (validates field exists, propagates domain error if not)
    let deliveredPayload = payload;
    if (input.field) {
      const field = input.field;
      const fieldValue = yield* resolveFieldOrDenyAudit(payload, field, {
        itemId: input.itemId,
        eventType: "access.reveal",
        deliveryMode: "reveal",
        purpose: input.purpose,
      });
      deliveredPayload = { ...payload, fields: { [field]: fieldValue } };
    }

    yield* logAgentAudit({
      organizationId: ctx.identity.agentOrganizationId,
      userId: ctx.identity.agentUserId,
      agentId: ctx.identity.agentId,
      itemId: input.itemId,
      eventType: "access.reveal",
      result: "allowed",
      deliveryMode: "reveal",
      field: input.field ?? "__default__",
      purpose: input.purpose,
      ipAddress: ctx.ipAddress,
    });

    return { payload: deliveredPayload };
  });

const accessMount = (input: MountAccessInput) =>
  Effect.gen(function* () {
    const ctx = yield* AgentRequestContextTag;
    const eventType = `access.mount_${input.mountType}` as const;

    if (ctx.identity.agentLocality !== "local") {
      yield* logAgentAudit({
        organizationId: ctx.identity.agentOrganizationId,
        userId: ctx.identity.agentUserId,
        agentId: ctx.identity.agentId,
        itemId: input.itemId,
        eventType,
        result: "denied",
        ipAddress: ctx.ipAddress,
      });

      return yield* Effect.fail(
        new ForbiddenError({
          code: "PERMISSION_DENIED",
          message: "Remote agents cannot mount",
          hint: "Use reveal_plaintext remotely or run the agent locally to mount secrets.",
        }),
      );
    }

    const item = yield* loadAccessibleItem(input.itemId);
    const capability: Capability = input.mountType === "env" ? "mount_env" : "mount_file";
    const permResult = yield* checkPermission(ctx.identity.agentId, input.itemId, capability);
    if (permResult !== "allowed") {
      yield* logAgentAudit({
        organizationId: ctx.identity.agentOrganizationId,
        userId: ctx.identity.agentUserId,
        agentId: ctx.identity.agentId,
        itemId: input.itemId,
        eventType,
        result: permResult,
        ipAddress: ctx.ipAddress,
      });

      return yield* Effect.fail(
        permissionDeniedError(
          permResult,
          "Grant the matching mount capability on this item to the agent before retrying.",
        ),
      );
    }

    if (item.storageMode === "zero_knowledge") {
      // §W1S7-001 — see `accessCiphertext`; the mount path needs the same
      // AAD meta (itemId, profileId, contentVersion) forwarded to the
      // daemon so local XChaCha20-Poly1305 decrypt can rebuild the AAD.
      if (!item.profileId) {
        yield* logAgentAudit({
          organizationId: ctx.identity.agentOrganizationId,
          userId: ctx.identity.agentUserId,
          agentId: ctx.identity.agentId,
          itemId: input.itemId,
          eventType,
          result: "denied",
          ipAddress: ctx.ipAddress,
          meta: { reason: "zk item missing profileId" },
        });
        return yield* Effect.fail(
          new IntegrityError({
            code: "INTEGRITY_ERROR",
            message: "Zero-knowledge item is missing its profile binding",
            hint: "This indicates data corruption; contact support.",
            meta: { itemId: input.itemId },
          }),
        );
      }

      yield* logAgentAudit({
        organizationId: ctx.identity.agentOrganizationId,
        userId: ctx.identity.agentUserId,
        agentId: ctx.identity.agentId,
        itemId: input.itemId,
        eventType,
        result: "allowed",
        deliveryMode: `mount_${input.mountType}`,
        field: input.field ?? "__default__",
        purpose: input.purpose,
        ipAddress: ctx.ipAddress,
      });

      return {
        storageMode: "zero_knowledge" as const,
        encryptedItemKey: item.encryptedItemKey ?? "",
        ciphertext: item.ciphertext ?? "",
        cryptoVersion: item.cryptoVersion,
        itemId: item.id,
        profileId: item.profileId,
        contentVersion: item.contentVersion,
      };
    }

    const decrypted = yield* decryptServerManagedItem(item, eventType);
    const payload = decodeServerManagedPayload(item.id, decrypted);

    // Resolve field if specified (validates field exists, propagates domain error if not)
    let deliveredPayload = payload;
    if (input.field) {
      const field = input.field;
      const fieldValue = yield* resolveFieldOrDenyAudit(payload, field, {
        itemId: input.itemId,
        eventType,
        deliveryMode: `mount_${input.mountType}`,
        purpose: input.purpose,
      });
      deliveredPayload = { ...payload, fields: { [field]: fieldValue } };
    }

    yield* logAgentAudit({
      organizationId: ctx.identity.agentOrganizationId,
      userId: ctx.identity.agentUserId,
      agentId: ctx.identity.agentId,
      itemId: input.itemId,
      eventType,
      result: "allowed",
      deliveryMode: `mount_${input.mountType}`,
      field: input.field ?? "__default__",
      purpose: input.purpose,
      ipAddress: ctx.ipAddress,
    });

    return {
      storageMode: "server_managed" as const,
      payload: deliveredPayload,
    };
  });

/**
 * Server-enforced ceiling on bulk mount results. Prevents a misconfigured
 * profile (or a hostile DB-write adversary) from forcing the daemon to
 * decrypt thousands of items in one Bun.spawn call. The daemon socket is
 * newline-delimited JSON without an explicit framing limit, so the cap also
 * keeps RPC payloads well under any reasonable OS socket buffer.
 *
 * 256 = "comfortably more than any real .env file we've seen" without
 * meaningfully relaxing the DoS bound. Tune up if real usage demands.
 */
const BULK_MOUNT_ENV_MAX_ITEMS = 256;

const accessBulkMountEnv = (input: BulkMountEnvInput) =>
  Effect.gen(function* () {
    const ctx = yield* AgentRequestContextTag;

    // Local-only capability (CAPABILITY_MATRIX). Reject remote agents at the
    // gate. No per-item audit row — no items were accessed.
    if (ctx.identity.agentLocality !== "local") {
      return yield* Effect.fail(
        new ForbiddenError({
          code: "PERMISSION_DENIED",
          message: "Remote agents cannot bulk-mount env vars",
          hint: "Run the agent locally to use --all, or use access.reveal per-item remotely.",
        }),
      );
    }

    // Verify the profile belongs to the agent's org BEFORE returning anything.
    // Cross-org probing returns NOT_FOUND so existence isn't leaked.
    const [profile] = yield* tryAsync(() =>
      ctx.db
        .select({ id: profileRecords.id })
        .from(profileRecords)
        .where(
          and(
            eq(profileRecords.id, input.profileId),
            eq(profileRecords.organizationId, ctx.identity.agentOrganizationId),
          ),
        )
        .limit(1),
    );
    if (!profile) {
      return yield* Effect.fail(
        new NotFoundError({
          code: "PROFILE_NOT_FOUND",
          message: "Profile not found",
          hint: "Confirm the profileId belongs to the agent's organization.",
        }),
      );
    }

    // The user's hard invariant: profile is the trust boundary. The filter
    // sits in the same query as org+agent scoping, so a tampered CLI cannot
    // spoof a different profile. expiresAt IS NULL OR expiresAt > now —
    // mirrors checkPermission's tri-state collapsed into a SQL predicate.
    const now = new Date();
    const rows = yield* tryAsync(() =>
      ctx.db
        .select({
          item: items,
          permissionExpiresAt: permissionRecords.expiresAt,
        })
        .from(items)
        .innerJoin(
          permissionRecords,
          and(
            eq(permissionRecords.itemId, items.id),
            eq(permissionRecords.agentId, ctx.identity.agentId),
            eq(permissionRecords.capability, "mount_env"),
          ),
        )
        .where(
          and(
            eq(items.organizationId, ctx.identity.agentOrganizationId),
            eq(items.profileId, input.profileId),
            isNull(items.deletedAt),
            or(isNull(permissionRecords.expiresAt), gt(permissionRecords.expiresAt, now)),
          ),
        )
        .limit(BULK_MOUNT_ENV_MAX_ITEMS + 1),
    );

    if (rows.length > BULK_MOUNT_ENV_MAX_ITEMS) {
      return yield* Effect.fail(
        new BadRequestError({
          code: "BAD_REQUEST",
          message: `Profile has more than ${BULK_MOUNT_ENV_MAX_ITEMS} items granting mount_env to this agent`,
          hint: "Scope the profile to fewer items or run secrets explicitly with --item.",
          meta: { limit: BULK_MOUNT_ENV_MAX_ITEMS },
        }),
      );
    }

    const responseItems: BulkMountEnvItem[] = [];
    // Greptile P1 / phantom-audit fix: stage every "allowed" audit row for
    // the call and flush only after responseItems is fully built. If a later
    // item's decrypt fails (server-managed IntegrityError, ZK envelope
    // corruption mid-loop, etc.), Effect.fail short-circuits the gen and
    // the staged rows disappear — so the audit log never claims "allowed"
    // for items the agent never received. Denied rows are factually correct
    // ("the agent attempted access on a corrupt item") and can still flush
    // immediately at their failure site.
    type StagedAudit = Parameters<typeof logAgentAudit>[0];
    const pendingAllowedAudits: StagedAudit[] = [];

    for (const row of rows) {
      const item = row.item;

      if (item.storageMode === "zero_knowledge") {
        if (!item.profileId || !item.encryptedItemKey || !item.ciphertext) {
          // Per-item audit: this access was attempted (granted) but failed
          // due to data corruption. Hard-fail the whole bulk call so the
          // user notices, rather than silently dropping the item. Flush
          // the denied row immediately — it is factually correct.
          yield* logAgentAudit({
            organizationId: ctx.identity.agentOrganizationId,
            userId: ctx.identity.agentUserId,
            agentId: ctx.identity.agentId,
            itemId: item.id,
            profileId: item.profileId ?? undefined,
            eventType: "access.mount_env",
            result: "denied",
            ipAddress: ctx.ipAddress,
            meta: { viaBulk: true, reason: "zk item missing envelope or profile binding" },
          });
          return yield* Effect.fail(
            new IntegrityError({
              code: "INTEGRITY_ERROR",
              message: "Zero-knowledge item is missing required encryption fields",
              hint: "This indicates data corruption; contact support.",
              meta: { itemId: item.id },
            }),
          );
        }

        pendingAllowedAudits.push({
          organizationId: ctx.identity.agentOrganizationId,
          userId: ctx.identity.agentUserId,
          agentId: ctx.identity.agentId,
          itemId: item.id,
          profileId: item.profileId,
          eventType: "access.mount_env",
          result: "allowed",
          deliveryMode: "mount_env",
          ipAddress: ctx.ipAddress,
          meta: { viaBulk: true },
        });

        responseItems.push({
          storageMode: "zero_knowledge",
          itemId: item.id,
          label: item.label,
          encryptedItemKey: item.encryptedItemKey,
          ciphertext: item.ciphertext,
          cryptoVersion: item.cryptoVersion,
          profileId: item.profileId,
          contentVersion: item.contentVersion,
        });
        continue;
      }

      // server_managed branch — decrypt and ship the payload. If decrypt
      // fails (e.g., failMissingServerManagedData writes its own denied
      // audit then aborts), the gen short-circuits and pendingAllowedAudits
      // never flushes — so any earlier ZK items that were staged as
      // "allowed" do NOT leave audit rows. This is the load-bearing
      // property of the staging pattern.
      const decrypted = yield* decryptServerManagedItem(item, "access.mount_env");
      const payload = decodeServerManagedPayload(item.id, decrypted);

      pendingAllowedAudits.push({
        organizationId: ctx.identity.agentOrganizationId,
        userId: ctx.identity.agentUserId,
        agentId: ctx.identity.agentId,
        itemId: item.id,
        profileId: item.profileId ?? undefined,
        eventType: "access.mount_env",
        result: "allowed",
        deliveryMode: "mount_env",
        ipAddress: ctx.ipAddress,
        meta: { viaBulk: true },
      });

      responseItems.push({
        storageMode: "server_managed",
        itemId: item.id,
        label: item.label,
        payload,
      });
    }

    // All items resolved successfully — flush the staged audit rows. Any
    // earlier failure short-circuited via Effect.fail, in which case
    // pendingAllowedAudits is discarded with the gen frame and no phantom
    // "allowed" rows hit the audit table.
    for (const auditRow of pendingAllowedAudits) {
      yield* logAgentAudit(auditRow);
    }

    return { items: responseItems };
  });

// §RM-PR2 — ProfileUseAccessResponseSchema is defined here rather than in
// @abadge/core because it is a thin router-side adapter shape. Each item
// returns its own mountId; the daemon exchanges them concurrently.
const ProfileUseAccessResponseSchema = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      itemId: Schema.String.pipe(Schema.minLength(1)),
      mountId: Schema.String.pipe(Schema.minLength(1)),
      delivery: Schema.Literal("env", "file"),
      expiresAt: Schema.String,
    }),
  ),
});

export const accessRouter = createTrpcRouter({
  /** @deprecated Use `access.read` (canonical). Removal target: v0.6. */
  ciphertext: agentProcedure
    .input(strictSchema(CiphertextAccessSchema))
    .output(strictSchema(CiphertextAccessResponseSchema))
    .mutation(({ ctx, input }) => runAgentEffect(ctx, accessCiphertext(input))),
  /** @deprecated Use `access.read` (canonical). Removal target: v0.6. */
  reveal: agentProcedure
    .input(strictSchema(RevealAccessSchema))
    .output(strictSchema(RevealAccessResponseSchema))
    .mutation(({ ctx, input }) => runAgentEffect(ctx, accessReveal(input))),
  /** @deprecated Use `access.use` (canonical). Removal target: v0.6. */
  mount: agentProcedure
    .input(strictSchema(MountAccessSchema))
    .output(strictSchema(MountAccessResponseSchema))
    .mutation(({ ctx, input }) => runAgentEffect(ctx, accessMount(input))),
  /** @deprecated Use `access.useProfile` (canonical). Removal target: v0.6. */
  bulkMountEnv: agentProcedure
    .input(strictSchema(BulkMountEnvSchema))
    .output(strictSchema(BulkMountEnvResponseSchema))
    .mutation(({ ctx, input }) => runAgentEffect(ctx, accessBulkMountEnv(input))),

  // §RM-PR2 — Canonical access procedures. Unified pipeline handles both ZK
  // and server-managed storage, plus item-level AND profile-level grants.
  read: agentProcedure
    .input(strictSchema(ReadAccessSchema))
    .output(strictSchema(ReadAccessResponseSchema))
    .mutation(({ ctx, input }) =>
      runAgentEffect(
        ctx,
        Effect.gen(function* () {
          const result = yield* resolveAccess({
            itemId: input.itemId,
            action: "read",
            field: input.field,
            purpose: input.purpose,
          });
          // resolveAccess returns ReadResult | UseResult; narrow to read shape.
          if ("mountId" in result) {
            return yield* Effect.fail(
              new Error("internal: resolveAccess returned use result for read action"),
            );
          }
          return result;
        }),
      ),
    ),
  use: agentProcedure
    .input(strictSchema(UseAccessSchema))
    .output(strictSchema(UseAccessResponseSchema))
    .mutation(({ ctx, input }) =>
      runAgentEffect(
        ctx,
        Effect.gen(function* () {
          const result = yield* resolveAccess({
            itemId: input.itemId,
            action: "use",
            delivery: input.delivery,
            field: input.field,
            envVarName: input.envVarName,
            purpose: input.purpose,
          });
          if (!("mountId" in result)) {
            return yield* Effect.fail(
              new Error("internal: resolveAccess returned read result for use action"),
            );
          }
          return {
            mountId: result.mountId,
            delivery: result.delivery,
            expiresAt: result.expiresAt.toISOString(),
          };
        }),
      ),
    ),
  useProfile: agentProcedure
    .input(strictSchema(ProfileUseAccessSchema))
    .output(strictSchema(ProfileUseAccessResponseSchema))
    .mutation(({ ctx, input }) =>
      runAgentEffect(
        ctx,
        Effect.gen(function* () {
          const result = yield* resolveProfileAccess({
            profileId: input.profileId,
            action: "use",
            delivery: input.delivery,
            purpose: input.purpose,
          });
          return {
            items: result.items.map((it) => ({
              itemId: it.itemId,
              mountId: it.mountId,
              delivery: it.delivery,
              expiresAt: it.expiresAt.toISOString(),
            })),
          };
        }),
      ),
    ),
});

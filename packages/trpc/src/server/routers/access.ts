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
  RedeemMountResponseSchema,
  RedeemMountSchema,
  RevealAccessResponseSchema,
  RevealAccessSchema,
  resolveFieldValue,
  UseAccessResponseSchema,
  UseAccessSchema,
} from "@abadge/core";
import { and, eq, gt, isNull, or, sql } from "@abadge/db";
import { mountReservations } from "@abadge/db/schema";
import { Cause, Effect, Schema } from "effect";
import { logAgentAudit } from "../audit";
import { AgentRequestContextTag, runAgentEffect, strictSchema, tryAsync } from "../effect";
import { agentProcedure, createTrpcRouter } from "../init";
import { decodeServerManagedPayload } from "../item-payload";
import { type ScopedDb, scopedDb } from "../scoped-db";
import {
  decryptServerEnvelope,
  loadProfileContentKey,
  SERVER_DEK_MIN_VERSION,
} from "../server-envelope";
import {
  buildPermissionDeniedHint,
  buildPermissionDeniedMeta,
  type DenialHintTarget,
} from "./access/denial-hint";
import { resolveAccess, resolveProfileAccess } from "./access/pipeline";

/**
 * Missing-grant / expired denial for the item-target access endpoints. The
 * denied caller is an agent and cannot grant itself; for `denied` the hint
 * names the human actor and a copy-pasteable `abadge permission create`
 * command, and the same identifiers ride along on `meta`.
 */
function permissionDeniedError(
  result: "denied" | "expired",
  target: DenialHintTarget,
): ForbiddenError {
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
    hint: buildPermissionDeniedHint(target),
    meta: buildPermissionDeniedMeta(target),
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
  item: ScopedDb["tables"]["items"]["$inferSelect"],
  eventType: "access.reveal" | "access.mount_env" | "access.mount_file",
  cachedContentKey?: string,
) =>
  Effect.gen(function* () {
    const ctx = yield* AgentRequestContextTag;

    if (!item.serverCiphertext || !item.serverIv || item.serverKeyVersion == null) {
      return yield* failMissingServerManagedData(item.id, eventType);
    }

    const ciphertext = item.serverCiphertext;
    const iv = item.serverIv;
    const keyVersion = item.serverKeyVersion;

    return yield* tryAsync(() =>
      decryptServerEnvelope(
        ctx.db,
        ctx.env.ENCRYPTION_KEY,
        ctx.identity.agentOrganizationId,
        {
          id: item.id,
          profileId: item.profileId,
          serverCiphertext: ciphertext,
          serverIv: iv,
          serverKeyVersion: keyVersion,
        },
        cachedContentKey,
      ),
    ).pipe(
      // An authorized read that fails server-side decryption (corrupt
      // ciphertext, wrong/rotated key, missing DEK) still must leave an audit row.
      // decryptServerEnvelope self-audits nothing, so record the denial here. The
      // no-payload case is already audited above before this call runs. Audit-write
      // failures are swallowed so they cannot mask the primary decrypt error.
      Effect.tapError(() =>
        logAgentAudit({
          organizationId: ctx.identity.agentOrganizationId,
          userId: ctx.identity.agentUserId,
          agentId: ctx.identity.agentId,
          itemId: item.id,
          profileId: item.profileId ?? undefined,
          eventType,
          result: "denied",
          ipAddress: ctx.ipAddress,
          meta: { reason: "decrypt_failed" },
        }).pipe(Effect.catchAll(() => Effect.void)),
      ),
    );
  });

const checkPermission = (agentId: string, itemId: string, capability: Capability) =>
  Effect.gen(function* () {
    const ctx = yield* AgentRequestContextTag;
    const scope = scopedDb(ctx.db, ctx.identity.agentOrganizationId);
    const [permission] = yield* tryAsync(() =>
      scope.executor
        .select()
        .from(scope.tables.permissions)
        .where(
          and(
            // Defense-in-depth: filter through the scoped-db org choke-point
            // rather than relying on agentId/itemId being transitively in-org.
            scope.orgScope("permissions"),
            eq(scope.tables.permissions.agentId, agentId),
            eq(scope.tables.permissions.itemId, itemId),
            eq(scope.tables.permissions.capability, capability),
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
    const scope = scopedDb(ctx.db, ctx.identity.agentOrganizationId);
    const [item] = yield* tryAsync(() =>
      scope.executor
        .select()
        .from(scope.tables.items)
        .where(
          and(
            eq(scope.tables.items.id, itemId),
            scope.orgScope("items"),
            isNull(scope.tables.items.deletedAt),
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
        permissionDeniedError(permResult, {
          agentId: ctx.identity.agentId,
          itemId: input.itemId,
          capability: "read_ciphertext",
        }),
      );
    }

    // Local decrypt needs (itemId, profileId, contentVersion) to rebuild the
    // XChaCha20-Poly1305 AAD. Every ZK item must live inside a
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
        permissionDeniedError(permResult, {
          agentId: ctx.identity.agentId,
          itemId: input.itemId,
          capability: "reveal_plaintext",
        }),
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
        permissionDeniedError(permResult, {
          agentId: ctx.identity.agentId,
          itemId: input.itemId,
          capability,
        }),
      );
    }

    if (item.storageMode === "zero_knowledge") {
      // Like `accessCiphertext`, the mount path needs the same AAD meta
      // (itemId, profileId, contentVersion) forwarded to the
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

    const scope = scopedDb(ctx.db, ctx.identity.agentOrganizationId);

    // Verify the profile belongs to the agent's org BEFORE returning anything.
    // Cross-org probing returns NOT_FOUND so existence isn't leaked.
    const [profile] = yield* tryAsync(() =>
      scope.executor
        .select({ id: scope.tables.profiles.id })
        .from(scope.tables.profiles)
        .where(and(eq(scope.tables.profiles.id, input.profileId), scope.orgScope("profiles")))
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
      scope.executor
        .select({
          item: scope.tables.items,
          permissionExpiresAt: scope.tables.permissions.expiresAt,
        })
        .from(scope.tables.items)
        .innerJoin(
          scope.tables.permissions,
          and(
            scope.orgScope("permissions"),
            eq(scope.tables.permissions.itemId, scope.tables.items.id),
            eq(scope.tables.permissions.agentId, ctx.identity.agentId),
            eq(scope.tables.permissions.capability, "mount_env"),
          ),
        )
        .where(
          and(
            scope.orgScope("items"),
            eq(scope.tables.items.profileId, input.profileId),
            isNull(scope.tables.items.deletedAt),
            or(
              isNull(scope.tables.permissions.expiresAt),
              gt(scope.tables.permissions.expiresAt, now),
            ),
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

    // Every row is scoped to input.profileId, so all v3 items share one DEK.
    // Resolve+unwrap it once on first need and reuse it across the loop.
    let cachedContentKey: string | undefined;

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
      if (
        cachedContentKey === undefined &&
        item.serverKeyVersion !== null &&
        item.serverKeyVersion >= SERVER_DEK_MIN_VERSION
      ) {
        cachedContentKey = yield* tryAsync(() =>
          loadProfileContentKey(
            ctx.db,
            ctx.env.ENCRYPTION_KEY,
            ctx.identity.agentOrganizationId,
            input.profileId,
          ),
        );
      }
      const decrypted = yield* decryptServerManagedItem(item, "access.mount_env", cachedContentKey);
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

// Defined here rather than in @abadge/core because it is a thin router-side
// adapter shape. Each item returns its own mountId; the daemon exchanges them
// concurrently.
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

  // Canonical access procedures. The unified pipeline handles both ZK and
  // server-managed storage, plus item-level AND profile-level grants.
  read: agentProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/access/{itemId}/read",
        tags: ["access"],
        protect: true,
      },
    })
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
    .meta({
      openapi: { method: "POST", path: "/access/{itemId}/use", tags: ["access"], protect: true },
    })
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
    .meta({
      openapi: {
        method: "POST",
        path: "/profiles/{profileId}/access/use",
        tags: ["access"],
        protect: true,
      },
    })
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

  // Atomically consume a mount handle and return the underlying envelope (ZK)
  // or decrypted payload (server_managed). Cross-agent and
  // double-redemption are observable to the audit log as denied events; both
  // return NOT_FOUND so reservation existence cannot be probed.
  redeemMount: agentProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/access/mounts/{mountId}/redeem",
        tags: ["access"],
        protect: true,
      },
    })
    .input(strictSchema(RedeemMountSchema))
    .output(strictSchema(RedeemMountResponseSchema))
    .mutation(({ ctx, input }) => runAgentEffect(ctx, redeemMount(input.mountId))),
});

// ---------------------------------------------------------------------------
// redeemMount — atomic consumption + payload delivery
// ---------------------------------------------------------------------------

/**
 * Load and atomically consume a mount reservation. The UPDATE filters on
 * `consumed_at IS NULL`, `expires_at > NOW()`, AND `agent_id = ctx.agent.id`
 * in a single statement; if 0 rows return, the handle is stolen, expired, or
 * already consumed — all collapsed to NOT_FOUND so existence isn't leaked.
 */
const consumeReservation = (mountId: string) =>
  Effect.gen(function* () {
    const ctx = yield* AgentRequestContextTag;
    const now = new Date();
    const rows = yield* tryAsync(() =>
      ctx.db
        .update(mountReservations)
        .set({ consumedAt: now })
        .where(
          and(
            eq(mountReservations.mountId, mountId),
            eq(mountReservations.agentId, ctx.identity.agentId),
            isNull(mountReservations.consumedAt),
            gt(mountReservations.expiresAt, sql`NOW()`),
          ),
        )
        .returning(),
    );
    return rows[0] ?? null;
  });

/** Exported for unit reuse and for the SDK to call. */
export const redeemMount = (mountId: string) =>
  Effect.gen(function* () {
    const ctx = yield* AgentRequestContextTag;

    const reservation = yield* consumeReservation(mountId);
    if (!reservation) {
      // Failed atomic consume — write a denied audit row so stolen / expired /
      // double-redeem attempts are observable, then return NOT_FOUND.
      yield* logAgentAudit({
        organizationId: ctx.identity.agentOrganizationId,
        userId: ctx.identity.agentUserId,
        agentId: ctx.identity.agentId,
        eventType: "access.mount_env",
        result: "denied",
        ipAddress: ctx.ipAddress,
        meta: { via: "mount_redeem", reason: "reservation_unavailable", mountId },
      });
      return yield* Effect.fail(
        new NotFoundError({
          code: "MOUNT_NOT_FOUND",
          message: "Mount handle is not valid",
          hint:
            "The handle may be expired, already consumed, or owned by a different agent. " +
            "Mint a new one via access.use.",
        }),
      );
    }

    const eventType =
      reservation.delivery === "file"
        ? ("access.mount_file" as const)
        : ("access.mount_env" as const);
    const deliveryMode =
      reservation.delivery === "file" ? ("mount_file" as const) : ("mount_env" as const);

    const redeemScope = scopedDb(ctx.db, ctx.identity.agentOrganizationId);

    // Load the item (org-scoped, soft-delete-aware). If the item disappeared
    // between mint and redeem, treat it as integrity error — the reservation
    // FK should normally cascade, but a concurrent soft-delete is possible.
    const [item] = yield* tryAsync(() =>
      redeemScope.executor
        .select()
        .from(redeemScope.tables.items)
        .where(
          and(
            eq(redeemScope.tables.items.id, reservation.itemId),
            redeemScope.orgScope("items"),
            isNull(redeemScope.tables.items.deletedAt),
          ),
        )
        .limit(1),
    );
    if (!item) {
      yield* logAgentAudit({
        organizationId: ctx.identity.agentOrganizationId,
        userId: ctx.identity.agentUserId,
        agentId: ctx.identity.agentId,
        itemId: reservation.itemId,
        eventType,
        result: "denied",
        ipAddress: ctx.ipAddress,
        meta: { via: "mount_redeem", reason: "item_deleted_after_mint", mountId },
      });
      return yield* Effect.fail(
        new NotFoundError({
          code: "ITEM_NOT_FOUND",
          message: "The item backing this mount handle is no longer available.",
          hint: "The item was deleted between mint and redeem. Mint a new handle on a live item.",
        }),
      );
    }

    if (item.storageMode === "zero_knowledge") {
      if (!item.profileId || !item.encryptedItemKey || !item.ciphertext) {
        yield* logAgentAudit({
          organizationId: ctx.identity.agentOrganizationId,
          userId: ctx.identity.agentUserId,
          agentId: ctx.identity.agentId,
          itemId: item.id,
          profileId: item.profileId ?? undefined,
          eventType,
          result: "denied",
          ipAddress: ctx.ipAddress,
          meta: { via: "mount_redeem", reason: "zk item missing envelope or profile binding" },
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

      yield* logAgentAudit({
        organizationId: ctx.identity.agentOrganizationId,
        userId: ctx.identity.agentUserId,
        agentId: ctx.identity.agentId,
        itemId: item.id,
        profileId: item.profileId,
        eventType,
        result: "allowed",
        deliveryMode,
        ipAddress: ctx.ipAddress,
        meta: { via: "mount_redeem", mountId },
      });

      return {
        storageMode: "zero_knowledge" as const,
        delivery: reservation.delivery,
        encryptedItemKey: item.encryptedItemKey,
        ciphertext: item.ciphertext,
        cryptoVersion: item.cryptoVersion,
        contentVersion: item.contentVersion,
        label: item.label,
        itemId: item.id,
        profileId: item.profileId,
      };
    }

    // server_managed — decrypt with AAD bound to (org, profile, item, key version).
    if (!item.serverCiphertext || !item.serverIv || item.serverKeyVersion == null) {
      yield* logAgentAudit({
        organizationId: ctx.identity.agentOrganizationId,
        userId: ctx.identity.agentUserId,
        agentId: ctx.identity.agentId,
        itemId: item.id,
        profileId: item.profileId ?? undefined,
        eventType,
        result: "denied",
        ipAddress: ctx.ipAddress,
        meta: { via: "mount_redeem", reason: "server-managed item has no payload" },
      });
      return yield* Effect.fail(
        new IntegrityError({
          code: "INTEGRITY_ERROR",
          message: "Server-managed item has no encrypted payload",
          hint: "This item may need to be re-created; contact support if this persists.",
          meta: { itemId: item.id },
        }),
      );
    }

    // Version-branched decrypt: v1/v2 under the master key, v3 under the
    // per-profile DEK.
    const decrypted = yield* tryAsync(() =>
      decryptServerEnvelope(ctx.db, ctx.env.ENCRYPTION_KEY, ctx.identity.agentOrganizationId, {
        id: item.id,
        profileId: item.profileId,
        serverCiphertext: item.serverCiphertext as string,
        serverIv: item.serverIv as string,
        serverKeyVersion: item.serverKeyVersion,
      }),
    ).pipe(
      // An authorized redeem that fails server-side decryption still
      // must leave an audit row (the no-payload case is audited above). Swallow
      // audit-write failures so they cannot mask the primary decrypt error.
      Effect.tapError(() =>
        logAgentAudit({
          organizationId: ctx.identity.agentOrganizationId,
          userId: ctx.identity.agentUserId,
          agentId: ctx.identity.agentId,
          itemId: item.id,
          profileId: item.profileId ?? undefined,
          eventType,
          result: "denied",
          deliveryMode,
          ipAddress: ctx.ipAddress,
          meta: { via: "mount_redeem", mountId, reason: "decrypt_failed" },
        }).pipe(Effect.catchAll(() => Effect.void)),
      ),
    );
    const payload = decodeServerManagedPayload(item.id, decrypted);

    yield* logAgentAudit({
      organizationId: ctx.identity.agentOrganizationId,
      userId: ctx.identity.agentUserId,
      agentId: ctx.identity.agentId,
      itemId: item.id,
      profileId: item.profileId ?? undefined,
      eventType,
      result: "allowed",
      deliveryMode,
      ipAddress: ctx.ipAddress,
      meta: { via: "mount_redeem", mountId },
    });

    return {
      storageMode: "server_managed" as const,
      delivery: reservation.delivery,
      payload,
      label: item.label,
      itemId: item.id,
    };
  });

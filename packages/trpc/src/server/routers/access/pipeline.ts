import type {
  AgentLocality,
  Capability,
  DeliveryMode,
  ItemPayload,
  StorageMode,
} from "@abadge/core";
import {
  ForbiddenError,
  IntegrityError,
  LEGACY_TO_CANONICAL,
  NotFoundError,
  resolveFieldValue,
} from "@abadge/core";
import { serverDecrypt } from "@abadge/crypto/server";
import {
  profileIdForServerAad,
  SERVER_AAD_MIN_VERSION,
  type ServerAadMeta,
} from "@abadge/crypto/shared";
import { and, eq, inArray, isNull, or } from "@abadge/db";
import {
  items as itemRecords,
  mountReservations,
  permissions as permissionRecords,
  profiles as profileRecords,
} from "@abadge/db/schema";
import { Effect } from "effect";
import { logAgentAudit } from "../../audit";
import { AgentRequestContextTag, tryAsync } from "../../effect";
import { decodeServerManagedPayload } from "../../item-payload";
import { checkActionConstraint } from "./constraints";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AccessAction = "read" | "use";

export interface ResolveAccessInput {
  itemId: string;
  action: AccessAction;
  delivery?: DeliveryMode;
  field?: string;
  envVarName?: string;
  purpose?: string;
}

export interface ResolveProfileAccessInput {
  profileId: string;
  action: AccessAction;
  delivery: DeliveryMode;
  purpose?: string;
}

export type ReadResult =
  | {
      storageMode: "server_managed";
      payload: ItemPayload & { label: string };
    }
  | {
      storageMode: "zero_knowledge";
      encryptedItemKey: string;
      ciphertext: string;
      cryptoVersion: number;
      itemId: string;
      profileId: string;
      contentVersion: number;
    };

export interface UseResult {
  mountId: string;
  delivery: DeliveryMode;
  expiresAt: Date;
}

export interface ProfileUseItem {
  itemId: string;
  mountId: string;
  delivery: DeliveryMode;
  expiresAt: Date;
}

export interface ProfileUseResult {
  items: ProfileUseItem[];
}

// ---------------------------------------------------------------------------
// Capability matching — legacy rows must satisfy canonical actions.
// ---------------------------------------------------------------------------

/**
 * §RM-PR2 — Canonical actions map to themselves + every legacy capability
 * that mapped to them. This lets existing permission rows (`reveal_plaintext`,
 * `mount_env`, etc.) continue to authorize calls against the new pipeline.
 */
export function legacyCapsForAction(action: AccessAction): readonly Capability[] {
  const set = new Set<Capability>([action]);
  for (const [legacy, canonical] of Object.entries(LEGACY_TO_CANONICAL)) {
    if (canonical === action) {
      set.add(legacy as Capability);
    }
  }
  return Array.from(set);
}

function eventTypeForAction(
  action: AccessAction,
  delivery: DeliveryMode | undefined,
): "access.reveal" | "access.mount_env" | "access.mount_file" {
  if (action === "read") return "access.reveal";
  return delivery === "file" ? "access.mount_file" : "access.mount_env";
}

const MOUNT_TTL_MS = 5 * 60 * 1000;

function generateMountId(): string {
  return `mnt_${crypto.randomUUID()}`;
}

// ---------------------------------------------------------------------------
// Permission lookup — accepts item-level OR profile-level grant.
// ---------------------------------------------------------------------------

interface PermissionMatch {
  id: string;
  expiresAt: Date | null;
  capability: Capability;
  viaProfileGrant: boolean;
}

const lookupPermission = (
  agentId: string,
  itemId: string,
  profileId: string | null,
  action: AccessAction,
) =>
  Effect.gen(function* () {
    const ctx = yield* AgentRequestContextTag;
    const caps = legacyCapsForAction(action);

    // Item-level grants are always considered. Profile-level grants only when
    // the item belongs to a profile (NULL would broaden the predicate to every
    // unbound row in the table).
    const itemMatch = and(
      eq(permissionRecords.itemId, itemId),
      inArray(permissionRecords.capability, caps),
    );
    const profileMatch =
      profileId !== null
        ? and(
            eq(permissionRecords.profileId, profileId),
            inArray(permissionRecords.capability, caps),
          )
        : null;

    const rows = yield* tryAsync(() =>
      ctx.db
        .select()
        .from(permissionRecords)
        .where(
          and(
            eq(permissionRecords.agentId, agentId),
            profileMatch ? or(itemMatch, profileMatch) : itemMatch,
          ),
        ),
    );

    if (rows.length === 0) return null;

    // Prefer non-expired, then prefer item-level (more specific). This keeps
    // a fresh profile grant from being shadowed by an expired item-level row.
    const now = new Date();
    const nonExpired = rows.filter((r) => !r.expiresAt || r.expiresAt > now);
    const pool = nonExpired.length > 0 ? nonExpired : rows;
    pool.sort((a, b) => {
      if (a.itemId && !b.itemId) return -1;
      if (!a.itemId && b.itemId) return 1;
      return 0;
    });
    const winner = pool[0];
    if (!winner) return null;
    return {
      id: winner.id,
      expiresAt: winner.expiresAt,
      capability: winner.capability as Capability,
      viaProfileGrant: winner.itemId === null,
    } satisfies PermissionMatch;
  });

// ---------------------------------------------------------------------------
// Item loader (org-scoped, soft-delete-aware).
// ---------------------------------------------------------------------------

const loadItem = (itemId: string) =>
  Effect.gen(function* () {
    const ctx = yield* AgentRequestContextTag;
    const [item] = yield* tryAsync(() =>
      ctx.db
        .select()
        .from(itemRecords)
        .where(
          and(
            eq(itemRecords.id, itemId),
            eq(itemRecords.organizationId, ctx.identity.agentOrganizationId),
            isNull(itemRecords.deletedAt),
          ),
        )
        .limit(1),
    );
    return item ?? null;
  });

// ---------------------------------------------------------------------------
// Server-managed decrypt — mirrors the existing access.ts AAD pattern exactly.
// ---------------------------------------------------------------------------

const decryptServerManaged = (
  item: typeof itemRecords.$inferSelect,
  eventType: "access.reveal" | "access.mount_env" | "access.mount_file",
) =>
  Effect.gen(function* () {
    const ctx = yield* AgentRequestContextTag;

    if (!item.serverCiphertext || !item.serverIv || item.serverKeyVersion == null) {
      yield* logAgentAudit({
        organizationId: ctx.identity.agentOrganizationId,
        userId: ctx.identity.agentUserId,
        agentId: ctx.identity.agentId,
        itemId: item.id,
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
          meta: { itemId: item.id },
        }),
      );
    }

    const ciphertext = item.serverCiphertext;
    const iv = item.serverIv;
    const keyVersion = item.serverKeyVersion;

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
      serverDecrypt({ ciphertext, iv, keyVersion }, ctx.env.ENCRYPTION_KEY, aadMeta),
    );
  });

// ---------------------------------------------------------------------------
// resolveAccess — single-item path.
// ---------------------------------------------------------------------------

export const resolveAccess = (
  input: ResolveAccessInput,
): Effect.Effect<
  ReadResult | UseResult,
  NotFoundError | ForbiddenError | IntegrityError | Error,
  AgentRequestContextTag
> =>
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: resolveAccess is the load-bearing unified pipeline: load item → constraint check → permission lookup (item-or-profile) → audit-staging → storage-mode branch → return. Splitting it would scatter the audit-before-decrypt invariant across helpers.
  Effect.gen(function* () {
    const ctx = yield* AgentRequestContextTag;
    const { itemId, action, delivery, field, envVarName, purpose } = input;
    const eventType = eventTypeForAction(action, delivery);

    // 1. Load item
    const item = yield* loadItem(itemId);
    if (!item) {
      yield* logAgentAudit({
        organizationId: ctx.identity.agentOrganizationId,
        userId: ctx.identity.agentUserId,
        agentId: ctx.identity.agentId,
        itemId,
        eventType,
        result: "denied",
        ipAddress: ctx.ipAddress,
        meta: { reason: "not_found" },
      });
      return yield* Effect.fail(
        new NotFoundError({
          code: "ITEM_NOT_FOUND",
          message: "Item not found",
          hint: "Check the item ID and confirm the agent belongs to the same organization.",
        }),
      );
    }

    // 2. Constraint check (locality × storageMode × action). On denial, write
    // an audit row before re-raising so the rejection is observable.
    const constraintCheck = Effect.try({
      try: () =>
        checkActionConstraint({
          action,
          locality: ctx.identity.agentLocality as AgentLocality,
          storageMode: item.storageMode as StorageMode,
        }),
      catch: (e) => (e instanceof ForbiddenError ? e : new Error(String(e))),
    });
    yield* constraintCheck.pipe(
      Effect.tapError((err) =>
        err instanceof ForbiddenError
          ? logAgentAudit({
              organizationId: ctx.identity.agentOrganizationId,
              userId: ctx.identity.agentUserId,
              agentId: ctx.identity.agentId,
              itemId,
              eventType,
              result: "denied",
              ipAddress: ctx.ipAddress,
              meta: { reason: err.code, action, storageMode: item.storageMode },
            })
          : Effect.void,
      ),
    );

    // 3. Permission lookup (item-level OR profile-level grant)
    const perm = yield* lookupPermission(ctx.identity.agentId, itemId, item.profileId, action);
    if (!perm) {
      yield* logAgentAudit({
        organizationId: ctx.identity.agentOrganizationId,
        userId: ctx.identity.agentUserId,
        agentId: ctx.identity.agentId,
        itemId,
        eventType,
        result: "denied",
        ipAddress: ctx.ipAddress,
        meta: { reason: "no_permission", action },
      });
      return yield* Effect.fail(
        new ForbiddenError({
          code: "PERMISSION_DENIED",
          message: `Agent lacks '${action}' permission for this item.`,
          hint: "Grant the matching capability on this item (or its profile) before retrying.",
          meta: { itemId, action },
        }),
      );
    }
    if (perm.expiresAt && perm.expiresAt < new Date()) {
      yield* logAgentAudit({
        organizationId: ctx.identity.agentOrganizationId,
        userId: ctx.identity.agentUserId,
        agentId: ctx.identity.agentId,
        itemId,
        eventType,
        result: "expired",
        ipAddress: ctx.ipAddress,
        meta: { permissionId: perm.id },
      });
      return yield* Effect.fail(
        new ForbiddenError({
          code: "PERMISSION_EXPIRED",
          message: "Permission has expired",
          hint: "Renew the permission or request a new grant before retrying.",
        }),
      );
    }

    // 4. Branch on action × storageMode.
    if (action === "read") {
      if (item.storageMode === "server_managed") {
        const decrypted = yield* decryptServerManaged(item, "access.reveal");
        const payload = decodeServerManagedPayload(item.id, decrypted);

        let delivered: ItemPayload & { label: string } = payload;
        if (field) {
          const value = resolveFieldValue(payload, field);
          delivered = { ...payload, fields: { [field]: value } };
        }

        yield* logAgentAudit({
          organizationId: ctx.identity.agentOrganizationId,
          userId: ctx.identity.agentUserId,
          agentId: ctx.identity.agentId,
          itemId,
          profileId: item.profileId ?? undefined,
          eventType: "access.reveal",
          result: "allowed",
          deliveryMode: "reveal",
          field: field ?? "__default__",
          purpose,
          ipAddress: ctx.ipAddress,
          meta: { action: "read", viaProfileGrant: perm.viaProfileGrant },
        });

        return { storageMode: "server_managed" as const, payload: delivered };
      }

      // ZK + read: envelope for client decrypt. Local-only path enforced by
      // the constraint check above.
      if (!item.profileId || !item.encryptedItemKey || !item.ciphertext) {
        yield* logAgentAudit({
          organizationId: ctx.identity.agentOrganizationId,
          userId: ctx.identity.agentUserId,
          agentId: ctx.identity.agentId,
          itemId,
          eventType: "access.reveal",
          result: "denied",
          ipAddress: ctx.ipAddress,
          meta: { reason: "zk item missing envelope or profile binding" },
        });
        return yield* Effect.fail(
          new IntegrityError({
            code: "INTEGRITY_ERROR",
            message: "Zero-knowledge item is missing required encryption fields",
            hint: "This indicates data corruption; contact support.",
            meta: { itemId },
          }),
        );
      }

      yield* logAgentAudit({
        organizationId: ctx.identity.agentOrganizationId,
        userId: ctx.identity.agentUserId,
        agentId: ctx.identity.agentId,
        itemId,
        profileId: item.profileId,
        eventType: "access.reveal",
        result: "allowed",
        deliveryMode: "reveal",
        field: field ?? "__default__",
        purpose,
        ipAddress: ctx.ipAddress,
        meta: { action: "read", viaProfileGrant: perm.viaProfileGrant },
      });

      return {
        storageMode: "zero_knowledge" as const,
        encryptedItemKey: item.encryptedItemKey,
        ciphertext: item.ciphertext,
        cryptoVersion: item.cryptoVersion,
        itemId: item.id,
        profileId: item.profileId,
        contentVersion: item.contentVersion,
      };
    }

    // action === "use" — mint a mount handle and persist a reservation.
    if (!delivery) {
      return yield* Effect.fail(new Error("internal: delivery required for action=use"));
    }

    const mountId = generateMountId();
    const expiresAt = new Date(Date.now() + MOUNT_TTL_MS);

    yield* tryAsync(() =>
      ctx.db.insert(mountReservations).values({
        id: crypto.randomUUID(),
        mountId,
        itemId,
        agentId: ctx.identity.agentId,
        delivery,
        field: field ?? null,
        envVarName: envVarName ?? null,
        expiresAt,
      }),
    );

    yield* logAgentAudit({
      organizationId: ctx.identity.agentOrganizationId,
      userId: ctx.identity.agentUserId,
      agentId: ctx.identity.agentId,
      itemId,
      profileId: item.profileId ?? undefined,
      eventType,
      result: "allowed",
      deliveryMode: `mount_${delivery}`,
      field: field ?? "__default__",
      purpose,
      ipAddress: ctx.ipAddress,
      meta: { action: "use", viaProfileGrant: perm.viaProfileGrant, mountId },
    });

    return { mountId, delivery, expiresAt } satisfies UseResult;
  });

// ---------------------------------------------------------------------------
// resolveProfileAccess — bulk `use` over every item in a profile.
//
// Mirrors the phantom-audit staging pattern from accessBulkMountEnv: stage
// every "allowed" audit row in memory, mint every mount reservation, and
// flush only after the full set succeeds. Any per-item failure short-circuits
// the gen and the staged rows + reservations are discarded.
// ---------------------------------------------------------------------------

const MAX_PROFILE_USE_ITEMS = 256;

export const resolveProfileAccess = (
  input: ResolveProfileAccessInput,
): Effect.Effect<
  ProfileUseResult,
  NotFoundError | ForbiddenError | IntegrityError | Error,
  AgentRequestContextTag
> =>
  Effect.gen(function* () {
    const ctx = yield* AgentRequestContextTag;
    const { profileId, action, delivery, purpose } = input;
    const eventType = eventTypeForAction(action, delivery);

    // Verify profile belongs to the agent's org BEFORE returning anything.
    // Cross-org probing returns NOT_FOUND so existence isn't leaked.
    const [profileRow] = yield* tryAsync(() =>
      ctx.db
        .select({ id: profileRecords.id })
        .from(profileRecords)
        .where(
          and(
            eq(profileRecords.id, profileId),
            eq(profileRecords.organizationId, ctx.identity.agentOrganizationId),
          ),
        )
        .limit(1),
    );
    if (!profileRow) {
      return yield* Effect.fail(
        new NotFoundError({
          code: "PROFILE_NOT_FOUND",
          message: "Profile not found",
          hint: "Confirm the profileId belongs to the agent's organization.",
        }),
      );
    }

    // Load every active item in the profile.
    const rows = yield* tryAsync(() =>
      ctx.db
        .select()
        .from(itemRecords)
        .where(
          and(
            eq(itemRecords.profileId, profileId),
            eq(itemRecords.organizationId, ctx.identity.agentOrganizationId),
            isNull(itemRecords.deletedAt),
          ),
        )
        .limit(MAX_PROFILE_USE_ITEMS + 1),
    );

    if (rows.length > MAX_PROFILE_USE_ITEMS) {
      return yield* Effect.fail(
        new ForbiddenError({
          code: "PERMISSION_DENIED",
          message: `Profile has more than ${MAX_PROFILE_USE_ITEMS} items`,
          hint: "Scope the profile to fewer items or call access.use per-item.",
          meta: { limit: MAX_PROFILE_USE_ITEMS },
        }),
      );
    }

    // Phantom-audit invariant: stage every audit + reservation; flush at end.
    type StagedAudit = Parameters<typeof logAgentAudit>[0];
    const pendingAudits: StagedAudit[] = [];
    const pendingReservations: (typeof mountReservations.$inferInsert)[] = [];
    const responseItems: ProfileUseItem[] = [];

    for (const item of rows) {
      // Constraint check per-item; failure short-circuits the bulk call.
      yield* Effect.try({
        try: () =>
          checkActionConstraint({
            action,
            locality: ctx.identity.agentLocality as AgentLocality,
            storageMode: item.storageMode as StorageMode,
          }),
        catch: (e) => (e instanceof ForbiddenError ? e : new Error(String(e))),
      }).pipe(
        Effect.tapError((err) =>
          err instanceof ForbiddenError
            ? logAgentAudit({
                organizationId: ctx.identity.agentOrganizationId,
                userId: ctx.identity.agentUserId,
                agentId: ctx.identity.agentId,
                itemId: item.id,
                profileId: item.profileId ?? undefined,
                eventType,
                result: "denied",
                ipAddress: ctx.ipAddress,
                meta: { reason: err.code, action, storageMode: item.storageMode },
              })
            : Effect.void,
        ),
      );

      // Permission lookup per-item; failure short-circuits the bulk call so
      // a single missing grant cannot produce a partial success.
      const perm = yield* lookupPermission(ctx.identity.agentId, item.id, item.profileId, action);
      if (!perm) {
        yield* logAgentAudit({
          organizationId: ctx.identity.agentOrganizationId,
          userId: ctx.identity.agentUserId,
          agentId: ctx.identity.agentId,
          itemId: item.id,
          profileId: item.profileId ?? undefined,
          eventType,
          result: "denied",
          ipAddress: ctx.ipAddress,
          meta: { reason: "no_permission", action, viaBulk: true },
        });
        return yield* Effect.fail(
          new ForbiddenError({
            code: "PERMISSION_DENIED",
            message: `Agent lacks '${action}' permission for item ${item.id}`,
            hint: "Grant the matching capability on this item (or its profile) before retrying.",
            meta: { itemId: item.id, action },
          }),
        );
      }
      if (perm.expiresAt && perm.expiresAt < new Date()) {
        yield* logAgentAudit({
          organizationId: ctx.identity.agentOrganizationId,
          userId: ctx.identity.agentUserId,
          agentId: ctx.identity.agentId,
          itemId: item.id,
          profileId: item.profileId ?? undefined,
          eventType,
          result: "expired",
          ipAddress: ctx.ipAddress,
          meta: { permissionId: perm.id, viaBulk: true },
        });
        return yield* Effect.fail(
          new ForbiddenError({
            code: "PERMISSION_EXPIRED",
            message: "Permission has expired",
            hint: "Renew the permission or request a new grant before retrying.",
          }),
        );
      }

      const mountId = generateMountId();
      const expiresAt = new Date(Date.now() + MOUNT_TTL_MS);

      pendingReservations.push({
        id: crypto.randomUUID(),
        mountId,
        itemId: item.id,
        agentId: ctx.identity.agentId,
        delivery,
        expiresAt,
      });

      pendingAudits.push({
        organizationId: ctx.identity.agentOrganizationId,
        userId: ctx.identity.agentUserId,
        agentId: ctx.identity.agentId,
        itemId: item.id,
        profileId: item.profileId ?? undefined,
        eventType,
        result: "allowed",
        deliveryMode: `mount_${delivery}`,
        purpose,
        ipAddress: ctx.ipAddress,
        meta: {
          action: "use",
          viaProfileGrant: perm.viaProfileGrant,
          viaBulk: true,
          mountId,
        },
      });

      responseItems.push({ itemId: item.id, mountId, delivery, expiresAt });
    }

    // All items resolved successfully — flush reservations + audits in one tx.
    if (pendingReservations.length > 0) {
      yield* tryAsync(() =>
        ctx.db.transaction(async (tx) => {
          await tx.insert(mountReservations).values(pendingReservations);
        }),
      );
    }
    for (const auditRow of pendingAudits) {
      yield* logAgentAudit(auditRow);
    }

    return { items: responseItems };
  });

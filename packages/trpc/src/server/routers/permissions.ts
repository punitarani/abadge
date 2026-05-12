import {
  type AgentLocality,
  BadRequestError,
  type Capability,
  ConflictError,
  type CreatePermissionInput,
  CreatePermissionSchema,
  ForbiddenError,
  getAllowedCapabilities,
  NotFoundError,
  PermissionListResultSchema,
  type StorageMode,
  SuccessResultSchema,
} from "@abadge/core";
import { and, eq, inArray, or } from "@abadge/db";
import {
  agents as agentRecords,
  auditLogs,
  items,
  permissions as permissionRecords,
} from "@abadge/db/schema";
import { Effect, Schema } from "effect";
import { auditDeniedSession, logSessionAudit } from "../audit";
import {
  isUniqueViolation,
  runSessionEffect,
  SessionRequestContextTag,
  strictSchema,
  tryAsync,
} from "../effect";
import {
  createTrpcRouter,
  requireAgentOwnership,
  requireOrgRole,
  scopedSessionProcedure,
} from "../init";
import { serializePermission } from "../serialize";

const PermissionIdSchema = Schema.Struct({
  permissionId: Schema.String.pipe(Schema.minLength(1)),
});

const PermissionListQuerySchema = Schema.Struct({
  agentId: Schema.optional(Schema.String),
  itemId: Schema.optional(Schema.String),
});

const createPermission = (input: CreatePermissionInput) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const [agent] = yield* tryAsync(() =>
      ctx.db
        .select()
        .from(agentRecords)
        .where(
          and(
            eq(agentRecords.id, input.agentId),
            eq(agentRecords.organizationId, ctx.identity.organizationId),
          ),
        )
        .limit(1),
    );

    if (!agent) {
      return yield* auditDeniedSession(
        {
          organizationId: ctx.identity.organizationId,
          userId: ctx.identity.userId,
          agentId: input.agentId,
          eventType: "permission.create",
          reason: "agent_not_found",
          ipAddress: ctx.ipAddress,
        },
        new NotFoundError({
          code: "AGENT_NOT_FOUND",
          message: "Agent not found",
          hint: "Check the agent ID and make sure it belongs to this organization.",
        }),
      );
    }

    const callerRole = yield* tryAsync(() =>
      requireOrgRole(ctx.db, ctx.identity.organizationId, ctx.identity.userId, "member"),
    ).pipe(
      Effect.tapError((err) =>
        err instanceof ForbiddenError
          ? logSessionAudit({
              organizationId: ctx.identity.organizationId,
              userId: ctx.identity.userId,
              agentId: input.agentId,
              eventType: "permission.create",
              result: "denied",
              ipAddress: ctx.ipAddress,
              meta: { reason: "insufficient_role" },
            })
          : Effect.void,
      ),
    );
    yield* tryAsync(() =>
      requireAgentOwnership(
        ctx.db,
        input.agentId,
        ctx.identity.userId,
        ctx.identity.organizationId,
        callerRole,
      ),
    ).pipe(
      Effect.tapError((err) =>
        err instanceof ForbiddenError
          ? logSessionAudit({
              organizationId: ctx.identity.organizationId,
              userId: ctx.identity.userId,
              agentId: input.agentId,
              eventType: "permission.create",
              result: "denied",
              ipAddress: ctx.ipAddress,
              meta: { reason: "agent_not_owned" },
            })
          : Effect.void,
      ),
    );

    const [item] = yield* tryAsync(() =>
      ctx.db
        .select()
        .from(items)
        .where(
          and(eq(items.id, input.itemId), eq(items.organizationId, ctx.identity.organizationId)),
        )
        .limit(1),
    );

    if (!item) {
      return yield* auditDeniedSession(
        {
          organizationId: ctx.identity.organizationId,
          userId: ctx.identity.userId,
          agentId: input.agentId,
          itemId: input.itemId,
          eventType: "permission.create",
          reason: "item_not_found",
          ipAddress: ctx.ipAddress,
        },
        new NotFoundError({
          code: "ITEM_NOT_FOUND",
          message: "Item not found",
          hint: "Check the item ID and make sure it belongs to this organization.",
        }),
      );
    }

    const agentLocality = agent.locality as AgentLocality;
    const itemStorageMode = item.storageMode as StorageMode;
    const requested = input.capabilities as readonly Capability[];
    const allowedCaps = getAllowedCapabilities(agentLocality, itemStorageMode);
    const allowedForOtherMode = getAllowedCapabilities(
      agentLocality,
      itemStorageMode === "zero_knowledge" ? "server_managed" : "zero_knowledge",
    );

    // Pre-pass: collect every offender so the SDK consumer sees the whole
    // list, not just the first failure. Locality wins over storage when the
    // capability is unreachable in either storage mode for this locality.
    const localityViolations: Capability[] = [];
    const storageViolations: Capability[] = [];
    for (const cap of requested) {
      if (allowedCaps.includes(cap)) continue;
      if (!allowedForOtherMode.includes(cap)) {
        localityViolations.push(cap);
      } else {
        storageViolations.push(cap);
      }
    }

    if (localityViolations.length > 0) {
      return yield* auditDeniedSession(
        {
          organizationId: ctx.identity.organizationId,
          userId: ctx.identity.userId,
          agentId: input.agentId,
          itemId: input.itemId,
          eventType: "permission.create",
          reason: "invalid_capability_locality",
          ipAddress: ctx.ipAddress,
          meta: { invalidCapabilities: localityViolations },
        },
        new BadRequestError({
          code: "INVALID_CAPABILITY_LOCALITY",
          message:
            localityViolations.length === 1
              ? `${agentLocality} agents cannot use the '${localityViolations[0]}' capability`
              : `${agentLocality} agents cannot use these capabilities: ${localityViolations.join(", ")}`,
          hint: "Choose capabilities supported by this agent's locality.",
          meta: { invalidCapabilities: localityViolations },
        }),
      );
    }

    if (storageViolations.length > 0) {
      return yield* auditDeniedSession(
        {
          organizationId: ctx.identity.organizationId,
          userId: ctx.identity.userId,
          agentId: input.agentId,
          itemId: input.itemId,
          eventType: "permission.create",
          reason: "invalid_capability_storage",
          ipAddress: ctx.ipAddress,
          meta: { invalidCapabilities: storageViolations },
        },
        new BadRequestError({
          code: "INVALID_CAPABILITY_STORAGE",
          message:
            storageViolations.length === 1
              ? `'${storageViolations[0]}' is not available for ${itemStorageMode} items`
              : `These capabilities are not available for ${itemStorageMode} items: ${storageViolations.join(", ")}`,
          hint: "Choose capabilities that match this item's storage mode.",
          meta: { invalidCapabilities: storageViolations },
        }),
      );
    }

    // Pre-check duplicates with one IN query so the error envelope can list
    // every duplicate, not just the first one we'd hit on insert. The unique
    // index inside the transaction is still the authoritative race-gate.
    const existingRows = yield* tryAsync(() =>
      ctx.db
        .select({ capability: permissionRecords.capability })
        .from(permissionRecords)
        .where(
          and(
            eq(permissionRecords.agentId, input.agentId),
            eq(permissionRecords.itemId, input.itemId),
            inArray(permissionRecords.capability, requested),
          ),
        ),
    );

    if (existingRows.length > 0) {
      const duplicates = existingRows.map((r) => r.capability as Capability);
      return yield* auditDeniedSession(
        {
          organizationId: ctx.identity.organizationId,
          userId: ctx.identity.userId,
          agentId: input.agentId,
          itemId: input.itemId,
          eventType: "permission.create",
          reason: "permission_already_exists",
          ipAddress: ctx.ipAddress,
          meta: { duplicateCapabilities: duplicates },
        },
        new ConflictError({
          code: "PERMISSION_ALREADY_EXISTS",
          message:
            duplicates.length === 1
              ? `Permission already exists for capability '${duplicates[0]}' on this agent and item`
              : `Permissions already exist for capabilities: ${duplicates.join(", ")}`,
          hint: "Revoke the existing permission(s) first, or omit those capabilities from this grant.",
          meta: { duplicateCapabilities: duplicates },
        }),
      );
    }

    const createdAt = new Date();
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    const rows = requested.map((capability) => ({
      id: crypto.randomUUID(),
      organizationId: ctx.identity.organizationId,
      agentId: input.agentId,
      itemId: input.itemId,
      // §RM-PR1 — profile-target grants are not wired through this router
      // yet (PR2); item-target rows must explicitly set profileId=null to
      // satisfy the new exactly-one-target CHECK constraint.
      profileId: null,
      capability,
      expiresAt,
      grantedBy: ctx.identity.userId,
      createdAt,
    }));

    yield* tryAsync(() =>
      ctx.db.transaction(async (tx) => {
        await tx.insert(permissionRecords).values(rows);
        // One audit row per granted capability — preserves the existing
        // 1:1 invariant between permission rows and permission.create events.
        for (const row of rows) {
          await tx.insert(auditLogs).values({
            organizationId: ctx.identity.organizationId,
            userId: ctx.identity.userId,
            agentId: input.agentId,
            itemId: input.itemId,
            profileId: null,
            surface: "api",
            eventType: "permission.create",
            result: "allowed",
            deliveryMode: null,
            field: null,
            purpose: null,
            meta: { capability: row.capability },
            ipAddress: ctx.ipAddress ?? null,
          });
        }
      }),
    ).pipe(
      // Race: a concurrent grant for one of the requested caps landed between
      // our pre-check and our insert. The unique index converts that into a
      // single conflict; we surface it with the same code as the pre-check.
      // The pre-check `IN` query covers the common case (single submitter,
      // possibly double-clicking) by listing every duplicate in `meta`. This
      // catch handles the rarer concurrent-batch race and intentionally does
      // NOT write a denial audit row — the request never reached the
      // post-validation grant path, matching the pre-existing behavior of
      // `permissions.create` for unique-violation conflicts.
      Effect.catchIf(
        (e: unknown) => isUniqueViolation(e),
        () =>
          Effect.fail(
            new ConflictError({
              code: "PERMISSION_ALREADY_EXISTS",
              message: "A concurrent grant created an overlapping permission.",
              hint: "Refresh the permission list and retry with the remaining capabilities.",
            }),
          ),
      ),
    );

    return {
      permissions: rows.map((row) => serializePermission(row)),
    };
  });

const listPermissions = (input: Schema.Schema.Type<typeof PermissionListQuerySchema>) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const userAgents = yield* tryAsync(() =>
      ctx.db
        .select({ id: agentRecords.id })
        .from(agentRecords)
        .where(eq(agentRecords.organizationId, ctx.identity.organizationId)),
    );

    const agentIds = userAgents.map((agent) => agent.id);
    if (agentIds.length === 0) {
      return { permissions: [] };
    }

    // Compose filters so callers can pass any subset of {agentId, itemId} and
    // get a consistent AND-narrowed result. The grant panel relies on the
    // (agentId, itemId) combination to discover already-granted caps.
    if (input.agentId && !agentIds.includes(input.agentId)) {
      return { permissions: [] };
    }
    if (input.itemId) {
      const itemId = input.itemId;
      const [item] = yield* tryAsync(() =>
        ctx.db
          .select({ id: items.id })
          .from(items)
          .where(and(eq(items.id, itemId), eq(items.organizationId, ctx.identity.organizationId)))
          .limit(1),
      );
      if (!item) {
        return { permissions: [] };
      }
    }

    const filters = [
      input.agentId
        ? eq(permissionRecords.agentId, input.agentId)
        : or(...agentIds.map((id) => eq(permissionRecords.agentId, id))),
    ];
    if (input.itemId) {
      filters.push(eq(permissionRecords.itemId, input.itemId));
    }

    const result = yield* tryAsync(() =>
      ctx.db
        .select()
        .from(permissionRecords)
        .where(and(...filters)),
    );

    return { permissions: result.map(serializePermission) };
  });

const revokePermission = (permissionId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const [permission] = yield* tryAsync(() =>
      ctx.db
        .select()
        .from(permissionRecords)
        .where(eq(permissionRecords.id, permissionId))
        .limit(1),
    );

    if (!permission) {
      return yield* auditDeniedSession(
        {
          organizationId: ctx.identity.organizationId,
          userId: ctx.identity.userId,
          eventType: "permission.revoke",
          reason: "permission_not_found",
          ipAddress: ctx.ipAddress,
        },
        new NotFoundError({
          code: "PERMISSION_NOT_FOUND",
          message: "Permission not found",
          hint: "Check the permission ID and make sure it still exists.",
        }),
      );
    }

    const [agent] = yield* tryAsync(() =>
      ctx.db
        .select({ id: agentRecords.id })
        .from(agentRecords)
        .where(
          and(
            eq(agentRecords.id, permission.agentId),
            eq(agentRecords.organizationId, ctx.identity.organizationId),
          ),
        )
        .limit(1),
    );

    if (!agent) {
      return yield* auditDeniedSession(
        {
          organizationId: ctx.identity.organizationId,
          userId: ctx.identity.userId,
          agentId: permission.agentId,
          eventType: "permission.revoke",
          reason: "permission_cross_org",
          ipAddress: ctx.ipAddress,
        },
        new NotFoundError({
          code: "PERMISSION_NOT_FOUND",
          message: "Permission not found",
          hint: "Check the permission ID and make sure it belongs to this organization.",
        }),
      );
    }

    const callerRole = yield* tryAsync(() =>
      requireOrgRole(ctx.db, ctx.identity.organizationId, ctx.identity.userId, "member"),
    ).pipe(
      Effect.tapError((err) =>
        err instanceof ForbiddenError
          ? logSessionAudit({
              organizationId: ctx.identity.organizationId,
              userId: ctx.identity.userId,
              agentId: permission.agentId,
              itemId: permission.itemId ?? undefined,
              eventType: "permission.revoke",
              result: "denied",
              ipAddress: ctx.ipAddress,
              meta: { reason: "insufficient_role" },
            })
          : Effect.void,
      ),
    );
    yield* tryAsync(() =>
      requireAgentOwnership(
        ctx.db,
        permission.agentId,
        ctx.identity.userId,
        ctx.identity.organizationId,
        callerRole,
      ),
    ).pipe(
      Effect.tapError((err) =>
        err instanceof ForbiddenError
          ? logSessionAudit({
              organizationId: ctx.identity.organizationId,
              userId: ctx.identity.userId,
              agentId: permission.agentId,
              itemId: permission.itemId ?? undefined,
              eventType: "permission.revoke",
              result: "denied",
              ipAddress: ctx.ipAddress,
              meta: { reason: "agent_not_owned" },
            })
          : Effect.void,
      ),
    );

    yield* tryAsync(() =>
      ctx.db.delete(permissionRecords).where(eq(permissionRecords.id, permissionId)),
    );

    yield* logSessionAudit({
      organizationId: ctx.identity.organizationId,
      userId: ctx.identity.userId,
      agentId: permission.agentId,
      itemId: permission.itemId ?? undefined,
      eventType: "permission.revoke",
      result: "allowed",
      ipAddress: ctx.ipAddress,
    });

    return { ok: true };
  });

export const permissionsRouter = createTrpcRouter({
  create: scopedSessionProcedure("permissions:write")
    .input(strictSchema(CreatePermissionSchema))
    .output(strictSchema(PermissionListResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, createPermission(input))),
  list: scopedSessionProcedure("permissions:read")
    .input(strictSchema(PermissionListQuerySchema))
    .output(strictSchema(PermissionListResultSchema))
    .query(({ ctx, input }) => runSessionEffect(ctx, listPermissions(input))),
  revoke: scopedSessionProcedure("permissions:write")
    .input(strictSchema(PermissionIdSchema))
    .output(strictSchema(SuccessResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, revokePermission(input.permissionId))),
});

import {
  type AgentLocality,
  BadRequestError,
  type Capability,
  ConflictError,
  type CreatePermissionInput,
  CreatePermissionSchema,
  getAllowedCapabilities,
  NotFoundError,
  PermissionListResultSchema,
  PermissionResultSchema,
  type StorageMode,
  SuccessResultSchema,
} from "@abadge/core";
import { and, eq, or } from "@abadge/db";
import { agents as agentRecords, items, permissions as permissionRecords } from "@abadge/db/schema";
import { Effect, Schema } from "effect";
import { logSessionAudit } from "../audit";
import { runSessionEffect, SessionRequestContextTag, strictSchema } from "../effect";
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
    const [agent] = yield* Effect.tryPromise(() =>
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
      return yield* Effect.fail(
        new NotFoundError({
          code: "AGENT_NOT_FOUND",
          message: "Agent not found",
          hint: "Check the agent ID and make sure it belongs to this organization.",
        }),
      );
    }

    const callerRole = yield* Effect.tryPromise(() =>
      requireOrgRole(ctx.db, ctx.identity.organizationId, ctx.identity.userId, "member"),
    );
    yield* Effect.tryPromise(() =>
      requireAgentOwnership(
        ctx.db,
        input.agentId,
        ctx.identity.userId,
        ctx.identity.organizationId,
        callerRole,
      ),
    );

    const [item] = yield* Effect.tryPromise(() =>
      ctx.db
        .select()
        .from(items)
        .where(
          and(eq(items.id, input.itemId), eq(items.organizationId, ctx.identity.organizationId)),
        )
        .limit(1),
    );

    if (!item) {
      return yield* Effect.fail(
        new NotFoundError({
          code: "ITEM_NOT_FOUND",
          message: "Item not found",
          hint: "Check the item ID and make sure it belongs to this organization.",
        }),
      );
    }

    const agentLocality = agent.locality as AgentLocality;
    const itemStorageMode = item.storageMode as StorageMode;
    const capability = input.capability as Capability;
    const allowedCaps = getAllowedCapabilities(agentLocality, itemStorageMode);

    if (!allowedCaps.includes(capability)) {
      // If the capability is not allowed for this locality in ANY storage mode,
      // the restriction is locality-based; otherwise it is storage-mode-based.
      const allowedForOtherMode = getAllowedCapabilities(
        agentLocality,
        itemStorageMode === "zero_knowledge" ? "server_managed" : "zero_knowledge",
      );

      if (!allowedForOtherMode.includes(capability)) {
        return yield* Effect.fail(
          new BadRequestError({
            code: "INVALID_CAPABILITY_LOCALITY",
            message: `${agentLocality} agents cannot use the '${capability}' capability`,
            hint: "Choose a capability supported by this agent's locality.",
          }),
        );
      }

      return yield* Effect.fail(
        new BadRequestError({
          code: "INVALID_CAPABILITY_STORAGE",
          message: `'${capability}' is not available for ${itemStorageMode} items`,
          hint: "Choose a capability that matches this item's storage mode.",
        }),
      );
    }

    const id = crypto.randomUUID();
    const createdAt = new Date();
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    yield* Effect.tryPromise(() =>
      ctx.db.insert(permissionRecords).values({
        id,
        organizationId: ctx.identity.organizationId,
        agentId: input.agentId,
        itemId: input.itemId,
        capability: input.capability,
        expiresAt,
        grantedBy: ctx.identity.userId,
        createdAt,
      }),
    ).pipe(
      Effect.catchIf(
        (e: unknown) =>
          typeof e === "object" && e !== null && "code" in e && (e as { code: unknown }).code === "23505",
        () =>
          Effect.fail(
            new ConflictError({
              code: "PERMISSION_ALREADY_EXISTS",
              message: "Permission already exists for this agent, item, and capability",
              hint: "Revoke the existing permission first, or use a different capability.",
            }),
          ),
      ),
    );

    yield* logSessionAudit({
      organizationId: ctx.identity.organizationId,
      userId: ctx.identity.userId,
      agentId: input.agentId,
      itemId: input.itemId,
      eventType: "permission.create",
      result: "allowed",
      ipAddress: ctx.ipAddress,
      meta: { capability: input.capability },
    });

    return {
      permission: serializePermission({
        id,
        organizationId: ctx.identity.organizationId,
        agentId: input.agentId,
        itemId: input.itemId,
        capability: input.capability,
        expiresAt,
        grantedBy: ctx.identity.userId,
        createdAt,
      }),
    };
  });

const listPermissions = (input: Schema.Schema.Type<typeof PermissionListQuerySchema>) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const userAgents = yield* Effect.tryPromise(() =>
      ctx.db
        .select({ id: agentRecords.id })
        .from(agentRecords)
        .where(eq(agentRecords.organizationId, ctx.identity.organizationId)),
    );

    const agentIds = userAgents.map((agent) => agent.id);
    if (agentIds.length === 0) {
      return { permissions: [] };
    }

    let result: Array<typeof permissionRecords.$inferSelect>;
    if (input.agentId) {
      const agentId = input.agentId;
      if (!agentIds.includes(agentId)) {
        return { permissions: [] };
      }
      result = yield* Effect.tryPromise(() =>
        ctx.db.select().from(permissionRecords).where(eq(permissionRecords.agentId, agentId)),
      );
    } else if (input.itemId) {
      const itemId = input.itemId;
      const [item] = yield* Effect.tryPromise(() =>
        ctx.db
          .select({ id: items.id })
          .from(items)
          .where(and(eq(items.id, itemId), eq(items.organizationId, ctx.identity.organizationId)))
          .limit(1),
      );

      if (!item) {
        return { permissions: [] };
      }

      result = yield* Effect.tryPromise(() =>
        ctx.db.select().from(permissionRecords).where(eq(permissionRecords.itemId, itemId)),
      );
    } else {
      result = yield* Effect.tryPromise(() =>
        ctx.db
          .select()
          .from(permissionRecords)
          .where(or(...agentIds.map((id) => eq(permissionRecords.agentId, id)))),
      );
    }

    return { permissions: result.map(serializePermission) };
  });

const revokePermission = (permissionId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const [permission] = yield* Effect.tryPromise(() =>
      ctx.db
        .select()
        .from(permissionRecords)
        .where(eq(permissionRecords.id, permissionId))
        .limit(1),
    );

    if (!permission) {
      return yield* Effect.fail(
        new NotFoundError({
          code: "PERMISSION_NOT_FOUND",
          message: "Permission not found",
          hint: "Check the permission ID and make sure it still exists.",
        }),
      );
    }

    const [agent] = yield* Effect.tryPromise(() =>
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
      return yield* Effect.fail(
        new NotFoundError({
          code: "PERMISSION_NOT_FOUND",
          message: "Permission not found",
          hint: "Check the permission ID and make sure it belongs to this organization.",
        }),
      );
    }

    const callerRole = yield* Effect.tryPromise(() =>
      requireOrgRole(ctx.db, ctx.identity.organizationId, ctx.identity.userId, "member"),
    );
    yield* Effect.tryPromise(() =>
      requireAgentOwnership(
        ctx.db,
        permission.agentId,
        ctx.identity.userId,
        ctx.identity.organizationId,
        callerRole,
      ),
    );

    yield* Effect.tryPromise(() =>
      ctx.db.delete(permissionRecords).where(eq(permissionRecords.id, permissionId)),
    );

    yield* logSessionAudit({
      organizationId: ctx.identity.organizationId,
      userId: ctx.identity.userId,
      agentId: permission.agentId,
      itemId: permission.itemId,
      eventType: "permission.revoke",
      result: "allowed",
      ipAddress: ctx.ipAddress,
    });

    return { ok: true };
  });

export const permissionsRouter = createTrpcRouter({
  create: scopedSessionProcedure("permissions:write")
    .input(strictSchema(CreatePermissionSchema))
    .output(strictSchema(PermissionResultSchema))
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

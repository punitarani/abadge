import type {
  Capability,
  CiphertextAccessInput,
  MountAccessInput,
  RevealAccessInput,
} from "@abadge/core";
import {
  BadRequestError,
  CiphertextAccessResponseSchema,
  CiphertextAccessSchema,
  FieldNotFoundError,
  ForbiddenError,
  IntegrityError,
  MountAccessResponseSchema,
  MountAccessSchema,
  MultiFieldItemError,
  NotFoundError,
  RevealAccessResponseSchema,
  RevealAccessSchema,
  resolveFieldValue,
} from "@abadge/core";
import { serverDecrypt } from "@abadge/crypto/server";
import { and, eq, isNull } from "@abadge/db";
import { items, permissions as permissionRecords } from "@abadge/db/schema";
import { Cause, Effect } from "effect";
import { logAgentAudit } from "../audit";
import { AgentRequestContextTag, runAgentEffect, strictSchema } from "../effect";
import { agentProcedure, createTrpcRouter } from "../init";
import { decodeServerManagedPayload } from "../item-payload";

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

    return yield* Effect.tryPromise(() =>
      serverDecrypt(
        {
          ciphertext,
          iv,
          keyVersion,
        },
        ctx.env.ENCRYPTION_KEY,
      ),
    );
  });

const checkPermission = (agentId: string, itemId: string, capability: Capability) =>
  Effect.gen(function* () {
    const ctx = yield* AgentRequestContextTag;
    const [permission] = yield* Effect.tryPromise(() =>
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
    const [item] = yield* Effect.tryPromise(() =>
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
    };
  });

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
      const fieldValue = yield* Effect.try({
        try: () => resolveFieldValue(payload, field),
        catch: (err) => {
          if (err instanceof FieldNotFoundError || err instanceof MultiFieldItemError) {
            return err;
          }
          return new Cause.UnknownException(err, "field resolution failed");
        },
      }).pipe(
        Effect.tapError((err) => {
          if (!(err instanceof FieldNotFoundError) && !(err instanceof MultiFieldItemError)) {
            return Effect.succeed(undefined);
          }
          return logAgentAudit({
            organizationId: ctx.identity.agentOrganizationId,
            userId: ctx.identity.agentUserId,
            agentId: ctx.identity.agentId,
            itemId: input.itemId,
            eventType: "access.reveal",
            result: "denied",
            deliveryMode: "reveal",
            field,
            purpose: input.purpose,
            ipAddress: ctx.ipAddress,
            meta: {
              reason: err._tag,
              availableFields: err.meta?.availableFields ?? [],
            },
          });
        }),
      );
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
      };
    }

    const decrypted = yield* decryptServerManagedItem(item, eventType);
    const payload = decodeServerManagedPayload(item.id, decrypted);

    // Resolve field if specified (validates field exists, propagates domain error if not)
    let deliveredPayload = payload;
    if (input.field) {
      const field = input.field;
      const fieldValue = yield* Effect.try({
        try: () => resolveFieldValue(payload, field),
        catch: (err) => {
          if (err instanceof FieldNotFoundError || err instanceof MultiFieldItemError) {
            return err;
          }
          return new Cause.UnknownException(err, "field resolution failed");
        },
      }).pipe(
        Effect.tapError((err) => {
          if (!(err instanceof FieldNotFoundError) && !(err instanceof MultiFieldItemError)) {
            return Effect.succeed(undefined);
          }
          return logAgentAudit({
            organizationId: ctx.identity.agentOrganizationId,
            userId: ctx.identity.agentUserId,
            agentId: ctx.identity.agentId,
            itemId: input.itemId,
            eventType,
            result: "denied",
            deliveryMode: `mount_${input.mountType}`,
            field,
            purpose: input.purpose,
            ipAddress: ctx.ipAddress,
            meta: {
              reason: err._tag,
              availableFields: err.meta?.availableFields ?? [],
            },
          });
        }),
      );
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

export const accessRouter = createTrpcRouter({
  ciphertext: agentProcedure
    .input(strictSchema(CiphertextAccessSchema))
    .output(strictSchema(CiphertextAccessResponseSchema))
    .mutation(({ ctx, input }) => runAgentEffect(ctx, accessCiphertext(input))),
  reveal: agentProcedure
    .input(strictSchema(RevealAccessSchema))
    .output(strictSchema(RevealAccessResponseSchema))
    .mutation(({ ctx, input }) => runAgentEffect(ctx, accessReveal(input))),
  mount: agentProcedure
    .input(strictSchema(MountAccessSchema))
    .output(strictSchema(MountAccessResponseSchema))
    .mutation(({ ctx, input }) => runAgentEffect(ctx, accessMount(input))),
});

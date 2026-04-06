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
  ForbiddenError,
  MountAccessResponseSchema,
  MountAccessSchema,
  NotFoundError,
  RevealAccessResponseSchema,
  RevealAccessSchema,
} from "@abadge/core";
import { serverDecrypt } from "@abadge/crypto/server";
import { and, eq, isNull } from "@abadge/db";
import { items, grants as permissionRecords } from "@abadge/db/schema";
import { Effect } from "effect";
import { logAgentAudit } from "../audit";
import { AgentRequestContextTag, runAgentEffect, strictSchema } from "../effect";
import { agentProcedure, createTrpcRouter } from "../init";
import { decodeServerManagedPayload } from "../item-payload";

const failMissingServerManagedData = (
  itemId: string,
  eventType: "access.reveal" | "access.mount_env" | "access.mount_file",
) =>
  Effect.gen(function* () {
    const ctx = yield* AgentRequestContextTag;

    yield* logAgentAudit({
      userId: ctx.identity.agentUserId,
      agentId: ctx.identity.agentId,
      itemId,
      eventType,
      result: "denied",
      ipAddress: ctx.ipAddress,
      meta: { reason: "item has no server-encrypted data" },
    });

    return yield* Effect.fail(new Error("Item has no server-encrypted data"));
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
            eq(permissionRecords.principalId, agentId),
            eq(permissionRecords.itemId, itemId),
            eq(permissionRecords.capability, capability),
          ),
        )
        .limit(1),
    );

    if (!permission) {
      return false;
    }

    if (permission.expiresAt && permission.expiresAt < new Date()) {
      return false;
    }

    return true;
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
            eq(items.userId, ctx.identity.agentUserId),
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
        }),
      );
    }

    const item = yield* loadAccessibleItem(input.itemId);
    if (item.storageMode !== "zero_knowledge") {
      yield* logAgentAudit({
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
        }),
      );
    }

    const hasPermission = yield* checkPermission(
      ctx.identity.agentId,
      input.itemId,
      "read_ciphertext",
    );
    if (!hasPermission) {
      yield* logAgentAudit({
        userId: ctx.identity.agentUserId,
        agentId: ctx.identity.agentId,
        itemId: input.itemId,
        eventType: "access.ciphertext",
        result: "denied",
        ipAddress: ctx.ipAddress,
      });

      return yield* Effect.fail(
        new ForbiddenError({
          code: "PERMISSION_DENIED",
          message: "No valid permission",
        }),
      );
    }

    yield* logAgentAudit({
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
        }),
      );
    }

    const hasPermission = yield* checkPermission(
      ctx.identity.agentId,
      input.itemId,
      "reveal_plaintext",
    );
    if (!hasPermission) {
      yield* logAgentAudit({
        userId: ctx.identity.agentUserId,
        agentId: ctx.identity.agentId,
        itemId: input.itemId,
        eventType: "access.reveal",
        result: "denied",
        ipAddress: ctx.ipAddress,
      });

      return yield* Effect.fail(
        new ForbiddenError({
          code: "PERMISSION_DENIED",
          message: "No valid permission",
        }),
      );
    }

    const decrypted = yield* decryptServerManagedItem(item, "access.reveal");

    yield* logAgentAudit({
      userId: ctx.identity.agentUserId,
      agentId: ctx.identity.agentId,
      itemId: input.itemId,
      eventType: "access.reveal",
      result: "allowed",
      deliveryMode: "reveal",
      ipAddress: ctx.ipAddress,
    });

    return {
      payload: decodeServerManagedPayload(item.id, decrypted),
    };
  });

const accessMount = (input: MountAccessInput) =>
  Effect.gen(function* () {
    const ctx = yield* AgentRequestContextTag;
    const eventType = `access.mount_${input.mountType}` as const;

    if (ctx.identity.agentLocality !== "local") {
      yield* logAgentAudit({
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
        }),
      );
    }

    const item = yield* loadAccessibleItem(input.itemId);
    const capability: Capability = input.mountType === "env" ? "mount_env" : "mount_file";
    const hasPermission = yield* checkPermission(ctx.identity.agentId, input.itemId, capability);
    if (!hasPermission) {
      yield* logAgentAudit({
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
          message: "No valid permission",
        }),
      );
    }

    if (item.storageMode === "zero_knowledge") {
      yield* logAgentAudit({
        userId: ctx.identity.agentUserId,
        agentId: ctx.identity.agentId,
        itemId: input.itemId,
        eventType,
        result: "allowed",
        deliveryMode: `mount_${input.mountType}`,
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

    yield* logAgentAudit({
      userId: ctx.identity.agentUserId,
      agentId: ctx.identity.agentId,
      itemId: input.itemId,
      eventType,
      result: "allowed",
      deliveryMode: `mount_${input.mountType}`,
      ipAddress: ctx.ipAddress,
    });

    return {
      storageMode: "server_managed" as const,
      payload: decodeServerManagedPayload(item.id, decrypted),
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

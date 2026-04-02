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
import { grants, items } from "@abadge/db/schema";
import { Effect } from "effect";
import { logPrincipalAudit } from "../audit";
import { PrincipalRequestContextTag, runPrincipalEffect, strictSchema } from "../effect";
import { createTrpcRouter, principalProcedure } from "../init";

function decodeServerManagedPayload(itemId: string, decrypted: Uint8Array) {
  const text = new TextDecoder().decode(decrypted);

  try {
    const parsed = JSON.parse(text);
    if (
      parsed &&
      typeof parsed === "object" &&
      "v" in parsed &&
      typeof parsed.v === "number" &&
      "label" in parsed &&
      typeof parsed.label === "string" &&
      "kind" in parsed &&
      parsed.kind === "opaque" &&
      "tags" in parsed &&
      Array.isArray(parsed.tags) &&
      parsed.tags.every((tag: unknown) => typeof tag === "string") &&
      "fields" in parsed &&
      parsed.fields &&
      typeof parsed.fields === "object" &&
      !Array.isArray(parsed.fields)
    ) {
      return parsed;
    }
  } catch {
    // Migrated items were stored as raw strings rather than structured payloads.
  }

  return {
    v: 1,
    label: `migrated-${itemId.slice(0, 8)}`,
    kind: "opaque" as const,
    tags: ["migrated"],
    fields: { value: text },
  };
}

const failMissingServerManagedData = (
  itemId: string,
  eventType: "access.reveal" | "access.mount_env" | "access.mount_file",
) =>
  Effect.gen(function* () {
    const ctx = yield* PrincipalRequestContextTag;

    yield* logPrincipalAudit({
      userId: ctx.identity.principalUserId,
      principalId: ctx.identity.principalId,
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
    const ctx = yield* PrincipalRequestContextTag;

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

const checkGrant = (principalId: string, itemId: string, capability: Capability) =>
  Effect.gen(function* () {
    const ctx = yield* PrincipalRequestContextTag;
    const [grant] = yield* Effect.tryPromise(() =>
      ctx.db
        .select()
        .from(grants)
        .where(
          and(
            eq(grants.principalId, principalId),
            eq(grants.itemId, itemId),
            eq(grants.capability, capability),
          ),
        )
        .limit(1),
    );

    if (!grant) {
      return false;
    }

    if (grant.expiresAt && grant.expiresAt < new Date()) {
      return false;
    }

    return true;
  });

const loadAccessibleItem = (itemId: string) =>
  Effect.gen(function* () {
    const ctx = yield* PrincipalRequestContextTag;
    const [item] = yield* Effect.tryPromise(() =>
      ctx.db
        .select()
        .from(items)
        .where(
          and(
            eq(items.id, itemId),
            eq(items.userId, ctx.identity.principalUserId),
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
    const ctx = yield* PrincipalRequestContextTag;

    if (ctx.identity.principalLocality !== "local") {
      yield* logPrincipalAudit({
        userId: ctx.identity.principalUserId,
        principalId: ctx.identity.principalId,
        itemId: input.itemId,
        eventType: "access.ciphertext",
        result: "denied",
        ipAddress: ctx.ipAddress,
        meta: { reason: "remote principal cannot read ciphertext" },
      });

      return yield* Effect.fail(
        new ForbiddenError({
          code: "GRANT_DENIED",
          message: "Remote principals cannot access ciphertext",
        }),
      );
    }

    const item = yield* loadAccessibleItem(input.itemId);
    if (item.storageMode !== "zero_knowledge") {
      yield* logPrincipalAudit({
        userId: ctx.identity.principalUserId,
        principalId: ctx.identity.principalId,
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

    const hasGrant = yield* checkGrant(ctx.identity.principalId, input.itemId, "read_ciphertext");
    if (!hasGrant) {
      yield* logPrincipalAudit({
        userId: ctx.identity.principalUserId,
        principalId: ctx.identity.principalId,
        itemId: input.itemId,
        eventType: "access.ciphertext",
        result: "denied",
        ipAddress: ctx.ipAddress,
      });

      return yield* Effect.fail(
        new ForbiddenError({
          code: "GRANT_DENIED",
          message: "No valid grant",
        }),
      );
    }

    yield* logPrincipalAudit({
      userId: ctx.identity.principalUserId,
      principalId: ctx.identity.principalId,
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
    const ctx = yield* PrincipalRequestContextTag;
    const item = yield* loadAccessibleItem(input.itemId);

    if (item.storageMode !== "server_managed") {
      yield* logPrincipalAudit({
        userId: ctx.identity.principalUserId,
        principalId: ctx.identity.principalId,
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

    const hasGrant = yield* checkGrant(ctx.identity.principalId, input.itemId, "reveal_plaintext");
    if (!hasGrant) {
      yield* logPrincipalAudit({
        userId: ctx.identity.principalUserId,
        principalId: ctx.identity.principalId,
        itemId: input.itemId,
        eventType: "access.reveal",
        result: "denied",
        ipAddress: ctx.ipAddress,
      });

      return yield* Effect.fail(
        new ForbiddenError({
          code: "GRANT_DENIED",
          message: "No valid grant",
        }),
      );
    }

    const decrypted = yield* decryptServerManagedItem(item, "access.reveal");

    yield* logPrincipalAudit({
      userId: ctx.identity.principalUserId,
      principalId: ctx.identity.principalId,
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
    const ctx = yield* PrincipalRequestContextTag;
    const eventType = `access.mount_${input.mountType}` as const;

    if (ctx.identity.principalLocality !== "local") {
      yield* logPrincipalAudit({
        userId: ctx.identity.principalUserId,
        principalId: ctx.identity.principalId,
        itemId: input.itemId,
        eventType,
        result: "denied",
        ipAddress: ctx.ipAddress,
      });

      return yield* Effect.fail(
        new ForbiddenError({
          code: "GRANT_DENIED",
          message: "Remote principals cannot mount",
        }),
      );
    }

    const item = yield* loadAccessibleItem(input.itemId);
    const capability: Capability = input.mountType === "env" ? "mount_env" : "mount_file";
    const hasGrant = yield* checkGrant(ctx.identity.principalId, input.itemId, capability);
    if (!hasGrant) {
      yield* logPrincipalAudit({
        userId: ctx.identity.principalUserId,
        principalId: ctx.identity.principalId,
        itemId: input.itemId,
        eventType,
        result: "denied",
        ipAddress: ctx.ipAddress,
      });

      return yield* Effect.fail(
        new ForbiddenError({
          code: "GRANT_DENIED",
          message: "No valid grant",
        }),
      );
    }

    if (item.storageMode === "zero_knowledge") {
      yield* logPrincipalAudit({
        userId: ctx.identity.principalUserId,
        principalId: ctx.identity.principalId,
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

    yield* logPrincipalAudit({
      userId: ctx.identity.principalUserId,
      principalId: ctx.identity.principalId,
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
  ciphertext: principalProcedure
    .input(strictSchema(CiphertextAccessSchema))
    .output(strictSchema(CiphertextAccessResponseSchema))
    .mutation(({ ctx, input }) => runPrincipalEffect(ctx, accessCiphertext(input))),
  reveal: principalProcedure
    .input(strictSchema(RevealAccessSchema))
    .output(strictSchema(RevealAccessResponseSchema))
    .mutation(({ ctx, input }) => runPrincipalEffect(ctx, accessReveal(input))),
  mount: principalProcedure
    .input(strictSchema(MountAccessSchema))
    .output(strictSchema(MountAccessResponseSchema))
    .mutation(({ ctx, input }) => runPrincipalEffect(ctx, accessMount(input))),
});

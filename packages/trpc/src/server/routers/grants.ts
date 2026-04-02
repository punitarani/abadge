import {
  BadRequestError,
  type CreateGrantInput,
  CreateGrantSchema,
  GrantListResultSchema,
  GrantResultSchema,
  NotFoundError,
  SuccessResultSchema,
} from "@abadge/core";
import { and, eq, or } from "@abadge/db";
import { grants, items, principals } from "@abadge/db/schema";
import { Effect, Schema } from "effect";
import { logSessionAudit } from "../audit";
import { runSessionEffect, SessionRequestContextTag, strictSchema } from "../effect";
import { createTrpcRouter, sessionProcedure } from "../init";
import { serializeGrant } from "../serialize";

const GrantIdSchema = Schema.Struct({
  grantId: Schema.String.pipe(Schema.minLength(1)),
});

const GrantListQuerySchema = Schema.Struct({
  principalId: Schema.optional(Schema.String),
  itemId: Schema.optional(Schema.String),
});

const createGrant = (input: CreateGrantInput) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const [principal] = yield* Effect.tryPromise(() =>
      ctx.db
        .select()
        .from(principals)
        .where(
          and(eq(principals.id, input.principalId), eq(principals.userId, ctx.identity.userId)),
        )
        .limit(1),
    );

    if (!principal) {
      return yield* Effect.fail(
        new NotFoundError({
          code: "PRINCIPAL_NOT_FOUND",
          message: "Principal not found",
        }),
      );
    }

    const [item] = yield* Effect.tryPromise(() =>
      ctx.db
        .select()
        .from(items)
        .where(and(eq(items.id, input.itemId), eq(items.userId, ctx.identity.userId)))
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

    if (principal.locality === "remote" && item.storageMode === "zero_knowledge") {
      return yield* Effect.fail(
        new BadRequestError({
          code: "INVALID_CAPABILITY",
          message: "Remote principals cannot access zero-knowledge items",
        }),
      );
    }

    if (principal.locality === "remote" && input.capability !== "reveal_plaintext") {
      return yield* Effect.fail(
        new BadRequestError({
          code: "INVALID_CAPABILITY",
          message: "Remote principals can only have reveal_plaintext capability",
        }),
      );
    }

    const id = crypto.randomUUID();
    const createdAt = new Date();
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    yield* Effect.tryPromise(() =>
      ctx.db.insert(grants).values({
        id,
        principalId: input.principalId,
        itemId: input.itemId,
        capability: input.capability,
        expiresAt,
        grantedBy: ctx.identity.userId,
        createdAt,
      }),
    );

    yield* logSessionAudit({
      userId: ctx.identity.userId,
      principalId: input.principalId,
      itemId: input.itemId,
      eventType: "grant.create",
      result: "allowed",
      ipAddress: ctx.ipAddress,
      meta: { capability: input.capability },
    });

    return {
      grant: serializeGrant({
        id,
        principalId: input.principalId,
        itemId: input.itemId,
        capability: input.capability,
        expiresAt,
        grantedBy: ctx.identity.userId,
        createdAt,
      }),
    };
  });

const listGrants = (input: Schema.Schema.Type<typeof GrantListQuerySchema>) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const userPrincipals = yield* Effect.tryPromise(() =>
      ctx.db
        .select({ id: principals.id })
        .from(principals)
        .where(eq(principals.userId, ctx.identity.userId)),
    );

    const principalIds = userPrincipals.map((principal) => principal.id);
    if (principalIds.length === 0) {
      return { grants: [] };
    }

    let result: Array<typeof grants.$inferSelect>;
    if (input.principalId) {
      const principalId = input.principalId;
      if (!principalIds.includes(input.principalId)) {
        return { grants: [] };
      }
      result = yield* Effect.tryPromise(() =>
        ctx.db.select().from(grants).where(eq(grants.principalId, principalId)),
      );
    } else if (input.itemId) {
      const itemId = input.itemId;
      const [item] = yield* Effect.tryPromise(() =>
        ctx.db
          .select({ id: items.id })
          .from(items)
          .where(and(eq(items.id, itemId), eq(items.userId, ctx.identity.userId)))
          .limit(1),
      );

      if (!item) {
        return { grants: [] };
      }

      result = yield* Effect.tryPromise(() =>
        ctx.db.select().from(grants).where(eq(grants.itemId, itemId)),
      );
    } else {
      result = yield* Effect.tryPromise(() =>
        ctx.db
          .select()
          .from(grants)
          .where(or(...principalIds.map((id) => eq(grants.principalId, id)))),
      );
    }

    return { grants: result.map(serializeGrant) };
  });

const revokeGrant = (grantId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const [grant] = yield* Effect.tryPromise(() =>
      ctx.db.select().from(grants).where(eq(grants.id, grantId)).limit(1),
    );

    if (!grant) {
      return yield* Effect.fail(
        new NotFoundError({
          code: "GRANT_NOT_FOUND",
          message: "Grant not found",
        }),
      );
    }

    const [principal] = yield* Effect.tryPromise(() =>
      ctx.db
        .select({ userId: principals.userId })
        .from(principals)
        .where(eq(principals.id, grant.principalId))
        .limit(1),
    );

    if (!principal || principal.userId !== ctx.identity.userId) {
      return yield* Effect.fail(
        new NotFoundError({
          code: "GRANT_NOT_FOUND",
          message: "Grant not found",
        }),
      );
    }

    yield* Effect.tryPromise(() => ctx.db.delete(grants).where(eq(grants.id, grantId)));

    yield* logSessionAudit({
      userId: ctx.identity.userId,
      principalId: grant.principalId,
      itemId: grant.itemId,
      eventType: "grant.revoke",
      result: "allowed",
      ipAddress: ctx.ipAddress,
    });

    return { ok: true };
  });

export const grantsRouter = createTrpcRouter({
  create: sessionProcedure
    .input(strictSchema(CreateGrantSchema))
    .output(strictSchema(GrantResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, createGrant(input))),
  list: sessionProcedure
    .input(strictSchema(GrantListQuerySchema))
    .output(strictSchema(GrantListResultSchema))
    .query(({ ctx, input }) => runSessionEffect(ctx, listGrants(input))),
  revoke: sessionProcedure
    .input(strictSchema(GrantIdSchema))
    .output(strictSchema(SuccessResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, revokeGrant(input.grantId))),
});

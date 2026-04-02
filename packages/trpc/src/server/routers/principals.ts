import {
  API_KEY_PREFIX,
  type CreatePrincipalInput,
  CreatePrincipalSchema,
  localityForKind,
  NotFoundError,
  PrincipalListResultSchema,
  PrincipalRegistrationSchema,
  PrincipalResultSchema,
  PrincipalRotateResultSchema,
  SuccessResultSchema,
} from "@abadge/core";
import { generateApiKey } from "@abadge/crypto/shared";
import { and, eq, isNull } from "@abadge/db";
import { principals } from "@abadge/db/schema";
import { Effect, Schema } from "effect";
import { logSessionAudit } from "../audit";
import { runSessionEffect, SessionRequestContextTag, strictSchema } from "../effect";
import { createTrpcRouter, sessionProcedure } from "../init";
import { serializePrincipal } from "../serialize";

const PrincipalIdSchema = Schema.Struct({
  principalId: Schema.String.pipe(Schema.minLength(1)),
});

const createPrincipal = (input: CreatePrincipalInput) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const locality = localityForKind(input.kind);
    const prefix = API_KEY_PREFIX[locality];
    const { key, hash, prefix: keyPrefix } = yield* Effect.tryPromise(() => generateApiKey(prefix));

    const id = crypto.randomUUID();
    yield* Effect.tryPromise(() =>
      ctx.db.insert(principals).values({
        id,
        userId: ctx.identity.userId,
        kind: input.kind,
        locality,
        name: input.name,
        secretHash: hash,
        secretPrefix: keyPrefix,
        metadata: input.metadata ?? {},
      }),
    );

    yield* logSessionAudit({
      userId: ctx.identity.userId,
      principalId: id,
      eventType: "principal.create",
      result: "allowed",
      ipAddress: ctx.ipAddress,
    });

    return {
      principal: serializePrincipal({
        id,
        userId: ctx.identity.userId,
        kind: input.kind,
        locality,
        name: input.name,
        secretHash: hash,
        secretPrefix: keyPrefix,
        publicKey: null,
        enabled: true,
        revokedAt: null,
        lastUsedAt: null,
        metadata: input.metadata ?? {},
        createdAt: new Date(),
      }),
      secret: key,
    };
  });

const listPrincipals = Effect.gen(function* () {
  const ctx = yield* SessionRequestContextTag;
  const result = yield* Effect.tryPromise(() =>
    ctx.db.select().from(principals).where(eq(principals.userId, ctx.identity.userId)),
  );

  return { principals: result.map(serializePrincipal) };
});

const getPrincipal = (principalId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const [principal] = yield* Effect.tryPromise(() =>
      ctx.db
        .select()
        .from(principals)
        .where(and(eq(principals.id, principalId), eq(principals.userId, ctx.identity.userId)))
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

    return { principal: serializePrincipal(principal) };
  });

const rotatePrincipal = (principalId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const [principal] = yield* Effect.tryPromise(() =>
      ctx.db
        .select()
        .from(principals)
        .where(
          and(
            eq(principals.id, principalId),
            eq(principals.userId, ctx.identity.userId),
            isNull(principals.revokedAt),
          ),
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

    const prefix = API_KEY_PREFIX[principal.locality as "local" | "remote"];
    const { key, hash, prefix: keyPrefix } = yield* Effect.tryPromise(() => generateApiKey(prefix));

    yield* Effect.tryPromise(() =>
      ctx.db
        .update(principals)
        .set({
          secretHash: hash,
          secretPrefix: keyPrefix,
        })
        .where(eq(principals.id, principalId)),
    );

    yield* logSessionAudit({
      userId: ctx.identity.userId,
      principalId,
      eventType: "principal.rotate",
      result: "allowed",
      ipAddress: ctx.ipAddress,
    });

    return {
      secret: key,
      secretPrefix: keyPrefix,
    };
  });

const revokePrincipal = (principalId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const [principal] = yield* Effect.tryPromise(() =>
      ctx.db
        .select({ id: principals.id })
        .from(principals)
        .where(and(eq(principals.id, principalId), eq(principals.userId, ctx.identity.userId)))
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

    yield* Effect.tryPromise(() =>
      ctx.db
        .update(principals)
        .set({
          revokedAt: new Date(),
          enabled: false,
        })
        .where(eq(principals.id, principalId)),
    );

    yield* logSessionAudit({
      userId: ctx.identity.userId,
      principalId,
      eventType: "principal.revoke",
      result: "allowed",
      ipAddress: ctx.ipAddress,
    });

    return { ok: true };
  });

export const principalsRouter = createTrpcRouter({
  create: sessionProcedure
    .input(strictSchema(CreatePrincipalSchema))
    .output(strictSchema(PrincipalRegistrationSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, createPrincipal(input))),
  list: sessionProcedure
    .output(strictSchema(PrincipalListResultSchema))
    .query(({ ctx }) => runSessionEffect(ctx, listPrincipals)),
  get: sessionProcedure
    .input(strictSchema(PrincipalIdSchema))
    .output(strictSchema(PrincipalResultSchema))
    .query(({ ctx, input }) => runSessionEffect(ctx, getPrincipal(input.principalId))),
  rotate: sessionProcedure
    .input(strictSchema(PrincipalIdSchema))
    .output(strictSchema(PrincipalRotateResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, rotatePrincipal(input.principalId))),
  revoke: sessionProcedure
    .input(strictSchema(PrincipalIdSchema))
    .output(strictSchema(SuccessResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, revokePrincipal(input.principalId))),
});

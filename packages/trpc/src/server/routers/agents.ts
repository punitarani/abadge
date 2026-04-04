import {
  AGENT_BOOTSTRAP_PREFIX,
  AGENT_BOOTSTRAP_TTL_MS,
  AgentListResultSchema,
  AgentRegistrationResultSchema,
  AgentResultSchema,
  AgentRotateResultSchema,
  API_KEY_PREFIX,
  agentLocalityForKind,
  type CreateAgentInput,
  CreateAgentSchema,
  ForbiddenError,
  NotFoundError,
  SuccessResultSchema,
} from "@abadge/core";
import { generateApiKey, generateOpaqueToken, hashApiKey } from "@abadge/crypto/shared";
import { and, eq, isNull } from "@abadge/db";
import { agentEnrollmentTokens, principals as agentRecords } from "@abadge/db/schema";
import { Effect, Schema } from "effect";
import { logSessionAudit } from "../audit";
import { runSessionEffect, SessionRequestContextTag, strictSchema } from "../effect";
import { createTrpcRouter, sessionProcedure } from "../init";
import { serializeAgent } from "../serialize";

const AgentIdSchema = Schema.Struct({
  agentId: Schema.String.pipe(Schema.minLength(1)),
});

const buildLegacyApiKey = (locality: "local" | "remote") =>
  Effect.gen(function* () {
    const generatedKey = yield* Effect.tryPromise(() => generateApiKey(API_KEY_PREFIX[locality]));
    return {
      apiKey: generatedKey.key,
      keyPrefix: generatedKey.prefix,
      secretHash: generatedKey.hash,
    };
  });

const buildBootstrapToken = (input: CreateAgentInput, authMethod: CreateAgentInput["authMethod"]) =>
  Effect.gen(function* () {
    if (
      authMethod !== "public_key_session" ||
      input.publicKey ||
      input.issueBootstrapToken === false
    ) {
      return {
        bootstrapToken: null,
        bootstrapHash: null,
        bootstrapExpiresAt: null,
      };
    }

    const bootstrapToken = generateOpaqueToken(AGENT_BOOTSTRAP_PREFIX);
    const bootstrapHash = yield* Effect.tryPromise(() => hashApiKey(bootstrapToken));
    return {
      bootstrapToken,
      bootstrapHash,
      bootstrapExpiresAt: new Date(Date.now() + AGENT_BOOTSTRAP_TTL_MS),
    };
  });

const createAgent = (input: CreateAgentInput) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const locality = agentLocalityForKind(input.kind);
    const authMethod = input.authMethod ?? "public_key_session";
    const id = crypto.randomUUID();
    const legacyKey =
      authMethod === "legacy_api_key"
        ? yield* buildLegacyApiKey(locality)
        : { apiKey: null, keyPrefix: null, secretHash: null };
    const bootstrap = yield* buildBootstrapToken(input, authMethod);

    yield* Effect.tryPromise(() =>
      ctx.db.insert(agentRecords).values({
        id,
        userId: ctx.identity.userId,
        kind: input.kind,
        locality,
        authMethod,
        name: input.name,
        secretHash: legacyKey.secretHash,
        secretPrefix: legacyKey.keyPrefix,
        publicKey: input.publicKey ?? null,
        metadata: input.metadata ?? {},
      }),
    );
    if (bootstrap.bootstrapHash && bootstrap.bootstrapExpiresAt) {
      yield* Effect.tryPromise(() =>
        ctx.db.insert(agentEnrollmentTokens).values({
          id: crypto.randomUUID(),
          agentId: id,
          userId: ctx.identity.userId,
          createdBy: ctx.identity.userId,
          tokenHash: bootstrap.bootstrapHash,
          expiresAt: bootstrap.bootstrapExpiresAt,
        }),
      );
    }

    yield* logSessionAudit({
      userId: ctx.identity.userId,
      agentId: id,
      eventType: "agent.create",
      result: "allowed",
      ipAddress: ctx.ipAddress,
    });

    return {
      agent: serializeAgent({
        id,
        userId: ctx.identity.userId,
        kind: input.kind,
        locality,
        authMethod,
        name: input.name,
        publicKey: input.publicKey ?? null,
        secretHash: legacyKey.secretHash,
        secretPrefix: legacyKey.keyPrefix,
        enabled: true,
        revokedAt: null,
        lastUsedAt: null,
        metadata: input.metadata ?? {},
        createdAt: new Date(),
      }),
      apiKey: legacyKey.apiKey,
      bootstrapToken: bootstrap.bootstrapToken,
      bootstrapExpiresAt: bootstrap.bootstrapExpiresAt?.toISOString() ?? null,
    };
  });

const listAgents = Effect.gen(function* () {
  const ctx = yield* SessionRequestContextTag;
  const result = yield* Effect.tryPromise(() =>
    ctx.db.select().from(agentRecords).where(eq(agentRecords.userId, ctx.identity.userId)),
  );

  return { agents: result.map(serializeAgent) };
});

const getAgent = (agentId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const [agent] = yield* Effect.tryPromise(() =>
      ctx.db
        .select()
        .from(agentRecords)
        .where(and(eq(agentRecords.id, agentId), eq(agentRecords.userId, ctx.identity.userId)))
        .limit(1),
    );

    if (!agent) {
      return yield* Effect.fail(
        new NotFoundError({
          code: "AGENT_NOT_FOUND",
          message: "Agent not found",
        }),
      );
    }

    return { agent: serializeAgent(agent) };
  });

const rotateAgent = (agentId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const [agent] = yield* Effect.tryPromise(() =>
      ctx.db
        .select()
        .from(agentRecords)
        .where(
          and(
            eq(agentRecords.id, agentId),
            eq(agentRecords.userId, ctx.identity.userId),
            isNull(agentRecords.revokedAt),
          ),
        )
        .limit(1),
    );

    if (!agent) {
      return yield* Effect.fail(
        new NotFoundError({
          code: "AGENT_NOT_FOUND",
          message: "Agent not found",
        }),
      );
    }

    if (agent.authMethod !== "legacy_api_key") {
      return yield* Effect.fail(
        new ForbiddenError({
          code: "PERMISSION_DENIED",
          message: "Only legacy API-key agents can be rotated",
        }),
      );
    }

    const prefix = API_KEY_PREFIX[agent.locality as "local" | "remote"];
    const { key, hash, prefix: keyPrefix } = yield* Effect.tryPromise(() => generateApiKey(prefix));

    yield* Effect.tryPromise(() =>
      ctx.db
        .update(agentRecords)
        .set({
          secretHash: hash,
          secretPrefix: keyPrefix,
        })
        .where(eq(agentRecords.id, agentId)),
    );

    yield* logSessionAudit({
      userId: ctx.identity.userId,
      agentId,
      eventType: "agent.rotate",
      result: "allowed",
      ipAddress: ctx.ipAddress,
    });

    return {
      apiKey: key,
      keyPrefix,
    };
  });

const revokeAgent = (agentId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const [agent] = yield* Effect.tryPromise(() =>
      ctx.db
        .select({ id: agentRecords.id })
        .from(agentRecords)
        .where(and(eq(agentRecords.id, agentId), eq(agentRecords.userId, ctx.identity.userId)))
        .limit(1),
    );

    if (!agent) {
      return yield* Effect.fail(
        new NotFoundError({
          code: "AGENT_NOT_FOUND",
          message: "Agent not found",
        }),
      );
    }

    yield* Effect.tryPromise(() =>
      ctx.db
        .update(agentRecords)
        .set({
          revokedAt: new Date(),
          enabled: false,
        })
        .where(eq(agentRecords.id, agentId)),
    );

    yield* logSessionAudit({
      userId: ctx.identity.userId,
      agentId,
      eventType: "agent.revoke",
      result: "allowed",
      ipAddress: ctx.ipAddress,
    });

    return { ok: true };
  });

export const agentsRouter = createTrpcRouter({
  create: sessionProcedure
    .input(strictSchema(CreateAgentSchema))
    .output(strictSchema(AgentRegistrationResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, createAgent(input))),
  list: sessionProcedure
    .output(strictSchema(AgentListResultSchema))
    .query(({ ctx }) => runSessionEffect(ctx, listAgents)),
  get: sessionProcedure
    .input(strictSchema(AgentIdSchema))
    .output(strictSchema(AgentResultSchema))
    .query(({ ctx, input }) => runSessionEffect(ctx, getAgent(input.agentId))),
  rotate: sessionProcedure
    .input(strictSchema(AgentIdSchema))
    .output(strictSchema(AgentRotateResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, rotateAgent(input.agentId))),
  revoke: sessionProcedure
    .input(strictSchema(AgentIdSchema))
    .output(strictSchema(SuccessResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, revokeAgent(input.agentId))),
});

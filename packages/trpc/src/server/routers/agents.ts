import {
  AgentListResultSchema,
  AgentResultSchema,
  AgentRotateResultSchema,
  AgentWithKeySchema,
  API_KEY_PREFIX,
  agentLocalityForKind,
  type CreateAgentInput,
  CreateAgentSchema,
  NotFoundError,
  SuccessResultSchema,
} from "@abadge/core";
import { generateApiKey } from "@abadge/crypto/shared";
import { and, eq, isNull } from "@abadge/db";
import { principals as agentRecords } from "@abadge/db/schema";
import { Effect, Schema } from "effect";
import { logSessionAudit } from "../audit";
import {
  AgentRequestContextTag,
  runAgentEffect,
  runSessionEffect,
  SessionRequestContextTag,
  strictSchema,
} from "../effect";
import { agentProcedure, createTrpcRouter, sessionProcedure } from "../init";
import { serializeAgent } from "../serialize";

const AgentIdSchema = Schema.Struct({
  agentId: Schema.String.pipe(Schema.minLength(1)),
});

const createAgent = (input: CreateAgentInput) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const locality = agentLocalityForKind(input.kind);
    const prefix = API_KEY_PREFIX[locality];
    const { key, hash, prefix: keyPrefix } = yield* Effect.tryPromise(() => generateApiKey(prefix));

    const id = crypto.randomUUID();
    yield* Effect.tryPromise(() =>
      ctx.db.insert(agentRecords).values({
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
      apiKey: key,
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

const getCurrentAgent = Effect.gen(function* () {
  const ctx = yield* AgentRequestContextTag;
  const [agent] = yield* Effect.tryPromise(() =>
    ctx.db.select().from(agentRecords).where(eq(agentRecords.id, ctx.identity.agentId)).limit(1),
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
    .output(strictSchema(AgentWithKeySchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, createAgent(input))),
  list: sessionProcedure
    .output(strictSchema(AgentListResultSchema))
    .query(({ ctx }) => runSessionEffect(ctx, listAgents)),
  self: agentProcedure
    .output(strictSchema(AgentResultSchema))
    .query(({ ctx }) => runAgentEffect(ctx, getCurrentAgent)),
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

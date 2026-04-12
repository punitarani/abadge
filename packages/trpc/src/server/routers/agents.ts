import {
  AGENT_BOOTSTRAP_PREFIX,
  AGENT_BOOTSTRAP_TTL_MS,
  AgentListResultSchema,
  AgentResultSchema,
  AgentRotateResultSchema,
  AgentWithKeySchema,
  API_KEY_PREFIX,
  agentLocalityForKind,
  BadRequestError,
  type CreateAgentInput,
  CreateAgentSchema,
  NotFoundError,
  SuccessResultSchema,
} from "@abadge/core";
import { generateApiKey, generateOpaqueToken, hashApiKey } from "@abadge/crypto/shared";
import { and, eq, isNull } from "@abadge/db";
import { agentEnrollmentTokens, principals as agentRecords } from "@abadge/db/schema";
import { Effect, Schema } from "effect";
import { logSessionAudit } from "../audit";
import {
  AgentRequestContextTag,
  runAgentEffect,
  runSessionEffect,
  SessionRequestContextTag,
  strictSchema,
} from "../effect";
import { agentProcedure, createTrpcRouter, scopedSessionProcedure } from "../init";
import { serializeAgent } from "../serialize";

const AgentIdSchema = Schema.Struct({
  agentId: Schema.String.pipe(Schema.minLength(1)),
});

const createAgent = (input: CreateAgentInput) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const locality = agentLocalityForKind(input.kind);
    // Default to public_key_session per v0 roadmap. legacy_api_key remains
    // available but must be requested explicitly.
    const authMethod = input.authMethod ?? "public_key_session";
    const id = crypto.randomUUID();

    let secretHash: string | null = null;
    let secretPrefix: string | null = null;
    let publicKey: string | null = null;
    let apiKey: string | null = null;
    let bootstrapToken: string | null = null;
    let bootstrapExpiresAt: string | null = null;
    let bootstrapTokenHash: string | null = null;

    if (authMethod === "legacy_api_key") {
      const prefix = API_KEY_PREFIX[locality];
      const generated = yield* Effect.tryPromise(() => generateApiKey(prefix));
      secretHash = generated.hash;
      secretPrefix = generated.prefix;
      apiKey = generated.key;
    } else if (input.publicKey) {
      publicKey = input.publicKey;
    } else if (input.issueBootstrapToken) {
      bootstrapToken = generateOpaqueToken(AGENT_BOOTSTRAP_PREFIX);
      bootstrapTokenHash = yield* Effect.tryPromise(() => hashApiKey(bootstrapToken as string));
      bootstrapExpiresAt = new Date(Date.now() + AGENT_BOOTSTRAP_TTL_MS).toISOString();
    } else {
      return yield* Effect.fail(
        new BadRequestError({
          code: "PUBLIC_KEY_REQUIRED",
          message:
            "public_key_session agents require either a publicKey or issueBootstrapToken: true",
          hint: "Provide a public key or request a bootstrap token for public_key_session agents.",
        }),
      );
    }

    yield* Effect.tryPromise(() =>
      ctx.db.insert(agentRecords).values({
        id,
        userId: ctx.identity.userId,
        kind: input.kind,
        locality,
        authMethod,
        name: input.name,
        secretHash,
        secretPrefix,
        publicKey,
        metadata: input.metadata ?? {},
      }),
    );

    if (bootstrapToken && bootstrapTokenHash && bootstrapExpiresAt) {
      yield* Effect.tryPromise(() =>
        ctx.db.insert(agentEnrollmentTokens).values({
          id: crypto.randomUUID(),
          agentId: id,
          userId: ctx.identity.userId,
          createdBy: ctx.identity.userId,
          tokenHash: bootstrapTokenHash as string,
          expiresAt: new Date(bootstrapExpiresAt as string),
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
        secretHash,
        secretPrefix,
        publicKey,
        enabled: true,
        revokedAt: null,
        lastUsedAt: null,
        metadata: input.metadata ?? {},
        createdAt: new Date(),
      }),
      apiKey,
      bootstrapToken,
      bootstrapExpiresAt,
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
          hint: "Check the agent ID and make sure it belongs to this account.",
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
        hint: "Check the current agent session and make sure the agent record still exists.",
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
          hint: "Check the agent ID and make sure it belongs to this account and is still active.",
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
          hint: "Check the agent ID and make sure it belongs to this account.",
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
  create: scopedSessionProcedure("agents:write")
    .input(strictSchema(CreateAgentSchema))
    .output(strictSchema(AgentWithKeySchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, createAgent(input))),
  list: scopedSessionProcedure("agents:read")
    .output(strictSchema(AgentListResultSchema))
    .query(({ ctx }) => runSessionEffect(ctx, listAgents)),
  self: agentProcedure
    .output(strictSchema(AgentResultSchema))
    .query(({ ctx }) => runAgentEffect(ctx, getCurrentAgent)),
  get: scopedSessionProcedure("agents:read")
    .input(strictSchema(AgentIdSchema))
    .output(strictSchema(AgentResultSchema))
    .query(({ ctx, input }) => runSessionEffect(ctx, getAgent(input.agentId))),
  rotate: scopedSessionProcedure("agents:write")
    .input(strictSchema(AgentIdSchema))
    .output(strictSchema(AgentRotateResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, rotateAgent(input.agentId))),
  revoke: scopedSessionProcedure("agents:write")
    .input(strictSchema(AgentIdSchema))
    .output(strictSchema(SuccessResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, revokeAgent(input.agentId))),
});

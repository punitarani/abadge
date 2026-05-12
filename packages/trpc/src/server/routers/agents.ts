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
  ConflictError,
  type CreateAgentInput,
  CreateAgentSchema,
  ForbiddenError,
  MAX_AGENTS_PER_ORG,
  NotFoundError,
  SuccessResultSchema,
} from "@abadge/core";
import { generateApiKey, generateOpaqueToken, hashApiKey } from "@abadge/crypto/shared";
import { and, count, eq, isNull } from "@abadge/db";
import { agentEnrollmentTokens, agents as agentRecords, auditLogs } from "@abadge/db/schema";
import { Effect, Schema } from "effect";
import { auditDeniedSession, logSessionAudit } from "../audit";
import { onAgentRevoked } from "../cascades";
import {
  AgentRequestContextTag,
  runAgentEffect,
  runSessionEffect,
  SessionRequestContextTag,
  strictSchema,
  tryAsync,
} from "../effect";
import {
  agentProcedure,
  createTrpcRouter,
  requireAgentOwnership,
  requireOrgRole,
  scopedSessionProcedure,
} from "../init";
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
      const generated = yield* tryAsync(() => generateApiKey(prefix));
      secretHash = generated.hash;
      secretPrefix = generated.prefix;
      apiKey = generated.key;
    } else if (input.publicKey) {
      publicKey = input.publicKey;
    } else if (input.issueBootstrapToken) {
      bootstrapToken = generateOpaqueToken(AGENT_BOOTSTRAP_PREFIX);
      bootstrapTokenHash = yield* tryAsync(() => hashApiKey(bootstrapToken as string));
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

    // §AGC1a — Enforce per-org agent quota before insert.
    const [countRow] = yield* tryAsync(() =>
      ctx.db
        .select({ count: count() })
        .from(agentRecords)
        .where(eq(agentRecords.organizationId, ctx.identity.organizationId)),
    );
    if ((countRow?.count ?? 0) >= MAX_AGENTS_PER_ORG) {
      return yield* Effect.fail(
        new ConflictError({
          code: "CONFLICT",
          message: `Organization has reached the ${MAX_AGENTS_PER_ORG} agent limit`,
          hint: "Delete or revoke unused agents before creating new ones.",
          meta: { currentCount: countRow?.count ?? 0, limit: MAX_AGENTS_PER_ORG },
        }),
      );
    }

    yield* tryAsync(() =>
      ctx.db.insert(agentRecords).values({
        id,
        organizationId: ctx.identity.organizationId,
        createdBy: ctx.identity.userId,
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
      yield* tryAsync(() =>
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
      organizationId: ctx.identity.organizationId,
      userId: ctx.identity.userId,
      agentId: id,
      eventType: "agent.create",
      result: "allowed",
      ipAddress: ctx.ipAddress,
    });

    return {
      agent: serializeAgent({
        id,
        organizationId: ctx.identity.organizationId,
        createdBy: ctx.identity.userId,
        kind: input.kind,
        locality,
        authMethod,
        name: input.name,
        description: null,
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
  const result = yield* tryAsync(() =>
    ctx.db
      .select()
      .from(agentRecords)
      .where(eq(agentRecords.organizationId, ctx.identity.organizationId)),
  );

  return { agents: result.map(serializeAgent) };
});

const getAgent = (agentId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const [agent] = yield* tryAsync(() =>
      ctx.db
        .select()
        .from(agentRecords)
        .where(
          and(
            eq(agentRecords.id, agentId),
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

    return { agent: serializeAgent(agent) };
  });

const getCurrentAgent = Effect.gen(function* () {
  const ctx = yield* AgentRequestContextTag;
  const [agent] = yield* tryAsync(() =>
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
    const [agent] = yield* tryAsync(() =>
      ctx.db
        .select()
        .from(agentRecords)
        .where(
          and(
            eq(agentRecords.id, agentId),
            eq(agentRecords.organizationId, ctx.identity.organizationId),
            isNull(agentRecords.revokedAt),
          ),
        )
        .limit(1),
    );

    if (!agent) {
      return yield* auditDeniedSession(
        {
          organizationId: ctx.identity.organizationId,
          userId: ctx.identity.userId,
          agentId,
          eventType: "agent.rotate",
          reason: "not_found",
          ipAddress: ctx.ipAddress,
        },
        new NotFoundError({
          code: "AGENT_NOT_FOUND",
          message: "Agent not found",
          hint: "Check the agent ID and make sure it belongs to this account and is still active.",
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
              agentId,
              eventType: "agent.rotate",
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
        agentId,
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
              agentId,
              eventType: "agent.rotate",
              result: "denied",
              ipAddress: ctx.ipAddress,
              meta: { reason: "agent_not_owned" },
            })
          : Effect.void,
      ),
    );

    if (agent.authMethod !== "legacy_api_key") {
      return yield* auditDeniedSession(
        {
          organizationId: ctx.identity.organizationId,
          userId: ctx.identity.userId,
          agentId,
          eventType: "agent.rotate",
          reason: "unsupported_auth_method",
          ipAddress: ctx.ipAddress,
        },
        new BadRequestError({
          code: "BAD_REQUEST",
          message: "Only legacy API key agents support key rotation",
          hint: "Public-key agents use keypair enrollment. Rotate the keypair instead.",
        }),
      );
    }

    const prefix = API_KEY_PREFIX[agent.locality as "local" | "remote"];
    const { key, hash, prefix: keyPrefix } = yield* tryAsync(() => generateApiKey(prefix));

    yield* tryAsync(() =>
      ctx.db
        .update(agentRecords)
        .set({
          secretHash: hash,
          secretPrefix: keyPrefix,
        })
        .where(eq(agentRecords.id, agentId)),
    );

    yield* logSessionAudit({
      organizationId: ctx.identity.organizationId,
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
    const [agent] = yield* tryAsync(() =>
      ctx.db
        .select({ id: agentRecords.id })
        .from(agentRecords)
        .where(
          and(
            eq(agentRecords.id, agentId),
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
          agentId,
          eventType: "agent.revoke",
          reason: "not_found",
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
              agentId,
              eventType: "agent.revoke",
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
        agentId,
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
              agentId,
              eventType: "agent.revoke",
              result: "denied",
              ipAddress: ctx.ipAddress,
              meta: { reason: "agent_not_owned" },
            })
          : Effect.void,
      ),
    );

    // Atomic: flip the agent record to revoked, write the primary
    // agent.revoke audit, and run the cascade (session invalidation + one
    // cascade audit per invalidated session) all inside one transaction.
    // Previous shape ran these as three sequential tryAsync steps; a
    // mid-flight failure could leave the agent disabled but still holding
    // live session tokens.
    const now = new Date();
    yield* tryAsync(() =>
      ctx.db.transaction(async (tx) => {
        await tx
          .update(agentRecords)
          .set({ revokedAt: now, enabled: false })
          .where(eq(agentRecords.id, agentId));

        await tx.insert(auditLogs).values({
          organizationId: ctx.identity.organizationId,
          userId: ctx.identity.userId,
          agentId,
          surface: "api",
          eventType: "agent.revoke",
          result: "allowed",
          ipAddress: ctx.ipAddress ?? null,
          meta: {},
        });

        await onAgentRevoked(
          tx,
          agentId,
          ctx.identity.organizationId,
          ctx.identity.userId,
          ctx.ipAddress,
        );
      }),
    );

    return { ok: true };
  });

export const agentsRouter = createTrpcRouter({
  create: scopedSessionProcedure("agents:write")
    .meta({ openapi: { method: "POST", path: "/agents", tags: ["agents"], protect: true } })
    .input(strictSchema(CreateAgentSchema))
    .output(strictSchema(AgentWithKeySchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, createAgent(input))),
  list: scopedSessionProcedure("agents:read")
    .meta({ openapi: { method: "GET", path: "/agents", tags: ["agents"], protect: true } })
    .output(strictSchema(AgentListResultSchema))
    .query(({ ctx }) => runSessionEffect(ctx, listAgents)),
  self: agentProcedure
    .output(strictSchema(AgentResultSchema))
    .query(({ ctx }) => runAgentEffect(ctx, getCurrentAgent)),
  get: scopedSessionProcedure("agents:read")
    .meta({
      openapi: { method: "GET", path: "/agents/{agentId}", tags: ["agents"], protect: true },
    })
    .input(strictSchema(AgentIdSchema))
    .output(strictSchema(AgentResultSchema))
    .query(({ ctx, input }) => runSessionEffect(ctx, getAgent(input.agentId))),
  rotate: scopedSessionProcedure("agents:write")
    .input(strictSchema(AgentIdSchema))
    .output(strictSchema(AgentRotateResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, rotateAgent(input.agentId))),
  revoke: scopedSessionProcedure("agents:write")
    .meta({
      openapi: { method: "DELETE", path: "/agents/{agentId}", tags: ["agents"], protect: true },
    })
    .input(strictSchema(AgentIdSchema))
    .output(strictSchema(SuccessResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, revokeAgent(input.agentId))),
});

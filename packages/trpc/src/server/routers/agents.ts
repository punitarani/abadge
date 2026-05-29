import {
  AGENT_BOOTSTRAP_PREFIX,
  AGENT_BOOTSTRAP_TTL_MS,
  AgentListResultSchema,
  AgentResultSchema,
  AgentWithKeySchema,
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
import {
  generateOpaqueToken,
  hashApiKey,
  normalizeEd25519PublicKeyJwk,
} from "@abadge/crypto/shared";
import { and, count, desc, eq, getTableColumns } from "@abadge/db";
import { agentEnrollmentTokens } from "@abadge/db/schema";
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
import {
  cursorCondition,
  decodeCursor,
  epochMicros,
  nextCursorFrom,
  resolveLimit,
} from "../pagination";
import { scopedDb } from "../scoped-db";
import { serializeAgent } from "../serialize";

const AgentIdSchema = Schema.Struct({
  agentId: Schema.String.pipe(Schema.minLength(1)),
});

const createAgent = (input: CreateAgentInput) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const scope = scopedDb(ctx.db, ctx.identity.organizationId);
    const locality = agentLocalityForKind(input.kind);
    // public_key_session is the only agent auth method. authMethod is accepted
    // for forward-compat but always resolves to public_key_session.
    const authMethod = input.authMethod ?? "public_key_session";
    const id = crypto.randomUUID();

    let publicKey: string | null = null;
    let bootstrapToken: string | null = null;
    let bootstrapExpiresAt: string | null = null;
    let bootstrapTokenHash: string | null = null;

    if (input.publicKey) {
      // Canonicalize the JWK before storing so a non-standard `alg` (Node's
      // WebCrypto stamps alg:"Ed25519") can't be persisted and later break the
      // session-exchange importKey(). The input schema already enforces
      // kty/crv/x, so this is also a defensive 400 for anything that slips through.
      publicKey = yield* Effect.try({
        try: () => normalizeEd25519PublicKeyJwk(input.publicKey as string),
        catch: (e) =>
          new BadRequestError({
            code: "BAD_REQUEST",
            message: e instanceof Error ? e.message : "Invalid public key JWK",
            hint: 'Provide a canonical Ed25519 public key JWK (kty:"OKP", crv:"Ed25519", base64url x).',
          }),
      });
    } else if (input.issueBootstrapToken) {
      bootstrapToken = generateOpaqueToken(AGENT_BOOTSTRAP_PREFIX);
      bootstrapTokenHash = yield* tryAsync(() => hashApiKey(bootstrapToken as string));
      bootstrapExpiresAt = new Date(Date.now() + AGENT_BOOTSTRAP_TTL_MS).toISOString();
    } else {
      return yield* Effect.fail(
        new BadRequestError({
          code: "PUBLIC_KEY_REQUIRED",
          message: "Agents require either a publicKey or issueBootstrapToken: true",
          hint: "Provide a public key or request a bootstrap token.",
        }),
      );
    }

    // §AGC1a — Enforce per-org agent quota before insert.
    const [countRow] = yield* tryAsync(() =>
      scope.executor
        .select({ count: count() })
        .from(scope.tables.agents)
        .where(scope.orgScope("agents")),
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
      scope.insert("agents", {
        id,
        createdBy: ctx.identity.userId,
        kind: input.kind,
        locality,
        authMethod,
        name: input.name,
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
        publicKey,
        enabled: true,
        revokedAt: null,
        lastUsedAt: null,
        metadata: input.metadata ?? {},
        createdAt: new Date(),
      }),
      bootstrapToken,
      bootstrapExpiresAt,
    };
  });

const AgentListQuerySchema = Schema.Struct({
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(
    Schema.Int.pipe(Schema.greaterThanOrEqualTo(1), Schema.lessThanOrEqualTo(100)),
  ),
});

const listAgents = (input: Schema.Schema.Type<typeof AgentListQuerySchema>) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const scope = scopedDb(ctx.db, ctx.identity.organizationId);
    const agentRecords = scope.tables.agents;
    // §AB-0050 — keyset pagination over (createdAt DESC, id DESC).
    const limit = resolveLimit(input.limit);
    const cursor = decodeCursor(input.cursor);
    const result = yield* tryAsync(() =>
      scope.executor
        .select({
          ...getTableColumns(agentRecords),
          createdAtUs: epochMicros(agentRecords.createdAt),
        })
        .from(agentRecords)
        .where(
          and(
            scope.orgScope("agents"),
            cursorCondition(agentRecords.createdAt, agentRecords.id, cursor),
          ),
        )
        .orderBy(desc(agentRecords.createdAt), desc(agentRecords.id))
        .limit(limit),
    );

    return { agents: result.map(serializeAgent), nextCursor: nextCursorFrom(result, limit) };
  });

const getAgent = (agentId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const scope = scopedDb(ctx.db, ctx.identity.organizationId);
    const agent = yield* tryAsync(() =>
      scope.findFirst("agents", { where: eq(scope.tables.agents.id, agentId) }),
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
  // Self-fetch is by agent id with no org narrowing: the session already binds
  // the agent to its org, so this uses the escape hatch rather than findFirst.
  const scope = scopedDb(ctx.db, ctx.identity.agentOrganizationId);
  const [agent] = yield* tryAsync(() =>
    scope.executor
      .select()
      .from(scope.tables.agents)
      .where(eq(scope.tables.agents.id, ctx.identity.agentId))
      .limit(1),
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

const revokeAgent = (agentId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const scope = scopedDb(ctx.db, ctx.identity.organizationId);
    const agent = yield* tryAsync(() =>
      scope.findFirst("agents", { where: eq(scope.tables.agents.id, agentId) }),
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

    // Atomic: flip the agent record to revoked, write the primary agent.revoke
    // audit, and run the cascade (session invalidation + one cascade audit per
    // invalidated session) in one transaction, so a mid-flight failure can't
    // leave the agent disabled but still holding live session tokens.
    const now = new Date();
    yield* tryAsync(() =>
      ctx.db.transaction(async (tx) => {
        const txScope = scopedDb(tx, ctx.identity.organizationId);
        await tx
          .update(txScope.tables.agents)
          .set({ revokedAt: now, enabled: false })
          .where(and(eq(txScope.tables.agents.id, agentId), txScope.orgScope("agents")));

        await txScope.insert("auditLogs", {
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
    // §AB-0050 — input is optional so existing no-arg `list()` callers keep
    // working (first page); pagination params are opt-in.
    .input(strictSchema(Schema.UndefinedOr(AgentListQuerySchema)))
    .output(strictSchema(AgentListResultSchema))
    .query(({ ctx, input }) => runSessionEffect(ctx, listAgents(input ?? {}))),
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
  revoke: scopedSessionProcedure("agents:write")
    .meta({
      openapi: { method: "DELETE", path: "/agents/{agentId}", tags: ["agents"], protect: true },
    })
    .input(strictSchema(AgentIdSchema))
    .output(strictSchema(SuccessResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, revokeAgent(input.agentId))),
});

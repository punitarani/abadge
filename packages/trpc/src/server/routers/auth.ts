import {
  AGENT_BOOTSTRAP_PREFIX,
  AGENT_BOOTSTRAP_TTL_MS,
  AGENT_CHALLENGE_PREFIX,
  AGENT_CHALLENGE_TTL_MS,
  AGENT_SESSION_PREFIX,
  AGENT_SESSION_TTL_MS,
  AgentBootstrapTokenResultSchema,
  AgentChallengeResultSchema,
  AgentEnrollmentResultSchema,
  AgentSessionResultSchema,
  type CreateAgentChallengeInput,
  CreateAgentChallengeSchema,
  type EnrollAgentInput,
  EnrollAgentSchema,
  type ExchangeAgentSessionInput,
  ExchangeAgentSessionSchema,
  ForbiddenError,
  type IssueAgentBootstrapTokenInput,
  IssueAgentBootstrapTokenSchema,
  NotFoundError,
  type RevokeAgentSessionInput,
  RevokeAgentSessionSchema,
  SuccessResultSchema,
} from "@abadge/core";
import { generateOpaqueToken, hashApiKey, verifyEd25519 } from "@abadge/crypto/shared";
import { and, eq, isNull } from "@abadge/db";
import {
  agentEnrollmentTokens,
  principals as agentRecords,
  agentSessionChallenges,
  agentSessions,
} from "@abadge/db/schema";
import { Effect } from "effect";
import { logBaseAudit, logSessionAudit } from "../audit";
import {
  BaseRequestContextTag,
  runBaseEffect,
  runSessionEffect,
  SessionRequestContextTag,
  strictSchema,
  tryAsync,
} from "../effect";
import { createTrpcRouter, publicProcedure, sessionProcedure } from "../init";
import { serializeAgent } from "../serialize";

type OwnedAgentRow = Pick<
  typeof agentRecords.$inferSelect,
  | "id"
  | "userId"
  | "name"
  | "kind"
  | "locality"
  | "authMethod"
  | "publicKey"
  | "secretPrefix"
  | "enabled"
  | "revokedAt"
  | "lastUsedAt"
  | "metadata"
  | "createdAt"
>;

interface ReturningIdRow {
  id: string;
}

interface RevocableAgentSessionRow {
  id: string;
  userId: string;
  agentId: string;
}

function notFound(): NotFoundError {
  return new NotFoundError({
    code: "AGENT_NOT_FOUND",
    message: "Agent not found",
  });
}

function disabledAgentError(): ForbiddenError {
  return new ForbiddenError({
    code: "PERMISSION_DENIED",
    message: "Agent is disabled",
  });
}

function revokedAgentError(): ForbiddenError {
  return new ForbiddenError({
    code: "AGENT_REVOKED",
    message: "Agent is revoked",
  });
}

const ensureAgentEligibleForEnrollment = (agent: OwnedAgentRow) =>
  Effect.gen(function* () {
    if (!agent.enabled) {
      return yield* Effect.fail(disabledAgentError());
    }

    if (agent.revokedAt) {
      return yield* Effect.fail(revokedAgentError());
    }

    if (agent.authMethod !== "public_key_session") {
      return yield* Effect.fail(
        new ForbiddenError({
          code: "PERMISSION_DENIED",
          message: "Agent does not support keypair enrollment",
        }),
      );
    }

    if (agent.publicKey) {
      return yield* Effect.fail(
        new ForbiddenError({
          code: "AGENT_ALREADY_ENROLLED",
          message: "Agent is already enrolled",
        }),
      );
    }
  });

const rejectSessionExchange = (
  agent: OwnedAgentRow,
  result: "denied" | "expired" | "revoked",
  reason: string,
  error: ForbiddenError,
) =>
  Effect.gen(function* () {
    const ctx = yield* BaseRequestContextTag;
    yield* logBaseAudit({
      userId: agent.userId,
      agentId: agent.id,
      eventType: "agent.session_reject",
      result,
      ipAddress: ctx.ipAddress,
      meta: { reason },
    });

    return yield* Effect.fail(error);
  });

const ensureAgentEligibleForSessionExchange = (agent: OwnedAgentRow) =>
  Effect.gen(function* () {
    if (!agent.enabled) {
      return yield* rejectSessionExchange(agent, "denied", "agent_disabled", disabledAgentError());
    }

    if (agent.revokedAt) {
      return yield* rejectSessionExchange(agent, "revoked", "agent_revoked", revokedAgentError());
    }

    if (!agent.publicKey) {
      return yield* rejectSessionExchange(
        agent,
        "denied",
        "agent_not_enrolled",
        new ForbiddenError({
          code: "AGENT_NOT_ENROLLED",
          message: "Agent is not enrolled",
        }),
      );
    }
  });

const loadOwnedAgent = (agentId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const [agent] = (yield* tryAsync(() =>
      ctx.db
        .select()
        .from(agentRecords)
        .where(and(eq(agentRecords.id, agentId), eq(agentRecords.userId, ctx.identity.userId)))
        .limit(1),
    )) as Array<OwnedAgentRow>;

    if (!agent) {
      return yield* Effect.fail(notFound());
    }

    return agent;
  });

const recordLogin = Effect.gen(function* () {
  const ctx = yield* SessionRequestContextTag;
  yield* logSessionAudit({
    userId: ctx.identity.userId,
    eventType: "auth.login",
    result: "allowed",
    ipAddress: ctx.ipAddress,
  });

  return { ok: true };
});

const recordLogout = Effect.gen(function* () {
  const ctx = yield* SessionRequestContextTag;
  yield* logSessionAudit({
    userId: ctx.identity.userId,
    eventType: "auth.logout",
    result: "allowed",
    ipAddress: ctx.ipAddress,
  });

  return { ok: true };
});

const issueBootstrapToken = (input: IssueAgentBootstrapTokenInput) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const agent = yield* loadOwnedAgent(input.agentId);

    if (!agent.enabled) {
      return yield* Effect.fail(
        new ForbiddenError({
          code: "PERMISSION_DENIED",
          message: "Agent is disabled",
        }),
      );
    }

    if (agent.revokedAt) {
      return yield* Effect.fail(
        new ForbiddenError({
          code: "AGENT_REVOKED",
          message: "Agent is revoked",
        }),
      );
    }

    if (agent.authMethod !== "public_key_session") {
      return yield* Effect.fail(
        new ForbiddenError({
          code: "PERMISSION_DENIED",
          message: "Bootstrap tokens are only available for keypair-backed agents",
        }),
      );
    }

    if (agent.publicKey) {
      return yield* Effect.fail(
        new ForbiddenError({
          code: "AGENT_ALREADY_ENROLLED",
          message: "Agent is already enrolled",
        }),
      );
    }

    const bootstrapToken = generateOpaqueToken(AGENT_BOOTSTRAP_PREFIX);
    const tokenHash = yield* tryAsync(() => hashApiKey(bootstrapToken));
    const expiresAt = new Date(Date.now() + AGENT_BOOTSTRAP_TTL_MS);

    yield* tryAsync(() =>
      ctx.db.insert(agentEnrollmentTokens).values({
        id: crypto.randomUUID(),
        agentId: agent.id,
        userId: agent.userId,
        createdBy: ctx.identity.userId,
        tokenHash,
        expiresAt,
      }),
    );

    yield* logSessionAudit({
      userId: ctx.identity.userId,
      agentId: agent.id,
      eventType: "agent.bootstrap_issue",
      result: "allowed",
      ipAddress: ctx.ipAddress,
    });

    return {
      agentId: agent.id,
      bootstrapToken,
      expiresAt: expiresAt.toISOString(),
    };
  });

const enrollAgent = (input: EnrollAgentInput) =>
  Effect.gen(function* () {
    const ctx = yield* BaseRequestContextTag;
    const tokenHash = yield* tryAsync(() => hashApiKey(input.bootstrapToken));

    const [bootstrap] = (yield* tryAsync(() =>
      ctx.db
        .select()
        .from(agentEnrollmentTokens)
        .where(
          and(eq(agentEnrollmentTokens.tokenHash, tokenHash), isNull(agentEnrollmentTokens.usedAt)),
        )
        .limit(1),
    )) as Array<typeof agentEnrollmentTokens.$inferSelect>;

    if (!bootstrap) {
      return yield* Effect.fail(
        new ForbiddenError({
          code: "INVALID_BOOTSTRAP_TOKEN",
          message: "Invalid bootstrap token",
        }),
      );
    }

    if (bootstrap.expiresAt <= new Date()) {
      return yield* Effect.fail(
        new ForbiddenError({
          code: "BOOTSTRAP_TOKEN_EXPIRED",
          message: "Bootstrap token expired",
        }),
      );
    }

    const [agent] = (yield* tryAsync(() =>
      ctx.db
        .select()
        .from(agentRecords)
        .where(
          and(eq(agentRecords.id, bootstrap.agentId), eq(agentRecords.userId, bootstrap.userId)),
        )
        .limit(1),
    )) as Array<OwnedAgentRow>;

    if (!agent) {
      return yield* Effect.fail(notFound());
    }
    yield* ensureAgentEligibleForEnrollment(agent);

    const enrolledAt = new Date();
    const claimedEnrollment = yield* tryAsync(() =>
      ctx.db.transaction(async (tx) => {
        const [claimedBootstrap] = (await tx
          .update(agentEnrollmentTokens)
          .set({ usedAt: enrolledAt })
          .where(
            and(
              eq(agentEnrollmentTokens.id, bootstrap.id),
              eq(agentEnrollmentTokens.tokenHash, tokenHash),
              isNull(agentEnrollmentTokens.usedAt),
            ),
          )
          .returning({ id: agentEnrollmentTokens.id })) as ReturningIdRow[];

        if (!claimedBootstrap) {
          return false;
        }

        const [updatedAgent] = (await tx
          .update(agentRecords)
          .set({
            publicKey: input.publicKey,
            secretHash: null,
            secretPrefix: null,
          })
          .where(
            and(
              eq(agentRecords.id, agent.id),
              eq(agentRecords.userId, agent.userId),
              eq(agentRecords.enabled, true),
              isNull(agentRecords.revokedAt),
              isNull(agentRecords.publicKey),
            ),
          )
          .returning({ id: agentRecords.id })) as ReturningIdRow[];

        if (!updatedAgent) {
          throw new ForbiddenError({
            code: "PERMISSION_DENIED",
            message: "Agent is no longer eligible for enrollment",
          });
        }

        return true;
      }),
    );

    if (!claimedEnrollment) {
      return yield* Effect.fail(
        new ForbiddenError({
          code: "INVALID_BOOTSTRAP_TOKEN",
          message: "Invalid or already used bootstrap token",
        }),
      );
    }

    yield* logBaseAudit({
      userId: agent.userId,
      agentId: agent.id,
      eventType: "agent.enroll",
      result: "allowed",
      ipAddress: ctx.ipAddress,
    });

    return {
      agent: serializeAgent({
        ...agent,
        publicKey: input.publicKey,
        secretHash: null,
        secretPrefix: null,
      }),
      enrolledAt: enrolledAt.toISOString(),
    };
  });

const createAgentChallenge = (input: CreateAgentChallengeInput) =>
  Effect.gen(function* () {
    const ctx = yield* BaseRequestContextTag;
    const [agent] = (yield* tryAsync(() =>
      ctx.db
        .select()
        .from(agentRecords)
        .where(
          and(
            eq(agentRecords.id, input.agentId),
            eq(agentRecords.enabled, true),
            isNull(agentRecords.revokedAt),
          ),
        )
        .limit(1),
    )) as Array<OwnedAgentRow>;

    if (!agent) {
      return yield* Effect.fail(notFound());
    }

    if (!agent.publicKey) {
      return yield* Effect.fail(
        new ForbiddenError({
          code: "AGENT_NOT_ENROLLED",
          message: "Agent is not enrolled",
        }),
      );
    }

    const challengeId = crypto.randomUUID();
    const challenge = generateOpaqueToken(AGENT_CHALLENGE_PREFIX);
    const challengeHash = yield* tryAsync(() => hashApiKey(challenge));
    const expiresAt = new Date(Date.now() + AGENT_CHALLENGE_TTL_MS);

    yield* tryAsync(() =>
      ctx.db.insert(agentSessionChallenges).values({
        id: challengeId,
        agentId: agent.id,
        challengeHash,
        expiresAt,
      }),
    );

    return {
      agentId: agent.id,
      challengeId,
      challenge,
      expiresAt: expiresAt.toISOString(),
    };
  });

const exchangeAgentSession = (input: ExchangeAgentSessionInput) =>
  Effect.gen(function* () {
    const ctx = yield* BaseRequestContextTag;
    const [agent] = (yield* tryAsync(() =>
      ctx.db.select().from(agentRecords).where(eq(agentRecords.id, input.agentId)).limit(1),
    )) as Array<OwnedAgentRow>;

    if (!agent) {
      return yield* Effect.fail(notFound());
    }
    yield* ensureAgentEligibleForSessionExchange(agent);

    const challengeHash = yield* tryAsync(() => hashApiKey(input.challenge));
    const [challengeRecord] = (yield* tryAsync(() =>
      ctx.db
        .select()
        .from(agentSessionChallenges)
        .where(
          and(
            eq(agentSessionChallenges.id, input.challengeId),
            eq(agentSessionChallenges.agentId, agent.id),
            eq(agentSessionChallenges.challengeHash, challengeHash),
            isNull(agentSessionChallenges.usedAt),
          ),
        )
        .limit(1),
    )) as Array<typeof agentSessionChallenges.$inferSelect>;

    if (!challengeRecord) {
      yield* logBaseAudit({
        userId: agent.userId,
        agentId: agent.id,
        eventType: "agent.session_reject",
        result: "denied",
        ipAddress: ctx.ipAddress,
        meta: { reason: "invalid_challenge" },
      });
      return yield* Effect.fail(
        new ForbiddenError({
          code: "AGENT_CHALLENGE_NOT_FOUND",
          message: "Invalid agent challenge",
        }),
      );
    }

    if (challengeRecord.expiresAt <= new Date()) {
      yield* logBaseAudit({
        userId: agent.userId,
        agentId: agent.id,
        eventType: "agent.session_reject",
        result: "expired",
        ipAddress: ctx.ipAddress,
        meta: { reason: "challenge_expired" },
      });
      return yield* Effect.fail(
        new ForbiddenError({
          code: "AGENT_CHALLENGE_EXPIRED",
          message: "Agent challenge expired",
        }),
      );
    }

    const validSignature = yield* tryAsync(() =>
      verifyEd25519(agent.publicKey ?? "", input.challenge, input.signature),
    );
    if (!validSignature) {
      yield* logBaseAudit({
        userId: agent.userId,
        agentId: agent.id,
        eventType: "agent.session_reject",
        result: "denied",
        ipAddress: ctx.ipAddress,
        meta: { reason: "invalid_signature" },
      });
      return yield* Effect.fail(
        new ForbiddenError({
          code: "PERMISSION_DENIED",
          message: "Invalid agent signature",
        }),
      );
    }

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + AGENT_SESSION_TTL_MS);
    const token = generateOpaqueToken(AGENT_SESSION_PREFIX);
    const tokenHash = yield* tryAsync(() => hashApiKey(token));
    const claimedChallenge = yield* tryAsync(() =>
      ctx.db.transaction(async (tx) => {
        const [claimed] = (await tx
          .update(agentSessionChallenges)
          .set({ usedAt: issuedAt })
          .where(
            and(
              eq(agentSessionChallenges.id, challengeRecord.id),
              eq(agentSessionChallenges.agentId, agent.id),
              eq(agentSessionChallenges.challengeHash, challengeHash),
              isNull(agentSessionChallenges.usedAt),
            ),
          )
          .returning({ id: agentSessionChallenges.id })) as ReturningIdRow[];

        if (!claimed) {
          return false;
        }

        await tx.insert(agentSessions).values({
          id: crypto.randomUUID(),
          agentId: agent.id,
          userId: agent.userId,
          tokenHash,
          expiresAt,
        });

        return true;
      }),
    );

    if (!claimedChallenge) {
      yield* logBaseAudit({
        userId: agent.userId,
        agentId: agent.id,
        eventType: "agent.session_reject",
        result: "denied",
        ipAddress: ctx.ipAddress,
        meta: { reason: "challenge_already_used" },
      });
      return yield* Effect.fail(
        new ForbiddenError({
          code: "AGENT_CHALLENGE_NOT_FOUND",
          message: "Invalid or already used agent challenge",
        }),
      );
    }

    yield* logBaseAudit({
      userId: agent.userId,
      agentId: agent.id,
      eventType: "agent.session_issue",
      result: "allowed",
      ipAddress: ctx.ipAddress,
    });

    return {
      agentId: agent.id,
      session: {
        token,
        expiresAt: expiresAt.toISOString(),
      },
    };
  });

const revokeAgentSession = (input: RevokeAgentSessionInput) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const tokenHash = yield* tryAsync(() => hashApiKey(input.token));
    const [sessionRecord] = (yield* tryAsync(() =>
      ctx.db
        .select({
          id: agentSessions.id,
          userId: agentSessions.userId,
          agentId: agentSessions.agentId,
        })
        .from(agentSessions)
        .where(
          and(
            eq(agentSessions.tokenHash, tokenHash),
            eq(agentSessions.userId, ctx.identity.userId),
            isNull(agentSessions.revokedAt),
          ),
        )
        .limit(1),
    )) as Array<RevocableAgentSessionRow>;

    if (!sessionRecord) {
      return { ok: true };
    }

    yield* tryAsync(() =>
      ctx.db
        .update(agentSessions)
        .set({ revokedAt: new Date() })
        .where(eq(agentSessions.id, sessionRecord.id)),
    );

    yield* logSessionAudit({
      userId: sessionRecord.userId,
      agentId: sessionRecord.agentId,
      eventType: "agent.session_revoke",
      result: "allowed",
      ipAddress: ctx.ipAddress,
    });

    return { ok: true };
  });

export const authRouter = createTrpcRouter({
  recordLogin: sessionProcedure
    .output(strictSchema(SuccessResultSchema))
    .mutation(({ ctx }) => runSessionEffect(ctx, recordLogin)),
  logout: sessionProcedure
    .output(strictSchema(SuccessResultSchema))
    .mutation(({ ctx }) => runSessionEffect(ctx, recordLogout)),
  issueBootstrapToken: sessionProcedure
    .input(strictSchema(IssueAgentBootstrapTokenSchema))
    .output(strictSchema(AgentBootstrapTokenResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, issueBootstrapToken(input))),
  enroll: publicProcedure
    .input(strictSchema(EnrollAgentSchema))
    .output(strictSchema(AgentEnrollmentResultSchema))
    .mutation(({ ctx, input }) => runBaseEffect(ctx, enrollAgent(input))),
  createChallenge: publicProcedure
    .input(strictSchema(CreateAgentChallengeSchema))
    .output(strictSchema(AgentChallengeResultSchema))
    .mutation(({ ctx, input }) => runBaseEffect(ctx, createAgentChallenge(input))),
  exchangeSession: publicProcedure
    .input(strictSchema(ExchangeAgentSessionSchema))
    .output(strictSchema(AgentSessionResultSchema))
    .mutation(({ ctx, input }) => runBaseEffect(ctx, exchangeAgentSession(input))),
  revokeSession: sessionProcedure
    .input(strictSchema(RevokeAgentSessionSchema))
    .output(strictSchema(SuccessResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, revokeAgentSession(input))),
});

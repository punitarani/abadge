import { seedOrgWithOwnerProfile, sendEmail } from "@abadge/auth";
import {
  AGENT_CLAIM_OTP_MAX_ATTEMPTS,
  AGENT_CLAIM_OTP_TTL_MS,
  AGENT_CLAIM_PREFIX,
  AGENT_CLAIM_TTL_MS,
  AGENT_POSTCLAIM_SCOPES,
  AGENT_PRECLAIM_SCOPES,
  type AgentClaimCompleteInput,
  AgentClaimCompleteResultSchema,
  AgentClaimCompleteSchema,
  type AgentClaimInput,
  AgentClaimResultSchema,
  AgentClaimSchema,
  AgentRegisterAnonymousResultSchema,
  AgentRegisterAnonymousSchema,
  BadRequestError,
  ConflictError,
  PERSONAL_ORG_METADATA,
  UNCLAIMED_ACCOUNT_EMAIL_DOMAIN,
  USER_API_KEY_PREFIX,
} from "@abadge/core";
import {
  generateApiKey,
  generateNumericOtp,
  generateOpaqueToken,
  hashApiKey,
  verifyApiKey,
} from "@abadge/crypto/shared";
import { and, eq, isNull, lt, sql } from "@abadge/db";
import { accountClaims, organization, user, userApiKeys } from "@abadge/db/schema";
import { Effect } from "effect";
import { logBaseAudit } from "../audit";
import {
  BaseRequestContextTag,
  isUniqueViolation,
  runBaseEffect,
  strictSchema,
  tryAsync,
} from "../effect";
import { createTrpcRouter, publicProcedure } from "../init";

type ClaimRow = typeof accountClaims.$inferSelect;

const apiBase = (raw: string | undefined): string => (raw ?? "").replace(/\/$/, "");

const invalidClaimToken = (): BadRequestError =>
  new BadRequestError({
    code: "INVALID_CLAIM_TOKEN",
    message: "Invalid claim token",
    hint: "Restart the claim ceremony from POST /agent/auth/claim with a fresh registration.",
  });

const claimTokenExpired = (): BadRequestError =>
  new BadRequestError({
    code: "CLAIM_TOKEN_EXPIRED",
    message: "Claim token expired",
    hint: "Register again via POST /agent/auth; unclaimed accounts expire after 24 hours.",
  });

const emailInUse = (): ConflictError =>
  new ConflictError({
    code: "CLAIM_EMAIL_IN_USE",
    message: "An account already exists for this email",
    hint: "Sign in to abadge with this email instead of claiming an agent-created account.",
  });

const auditClaimDenied = (record: ClaimRow, reason: string) =>
  Effect.gen(function* () {
    const ctx = yield* BaseRequestContextTag;
    yield* logBaseAudit({
      organizationId: record.organizationId,
      userId: record.userId,
      eventType: "account.claim_complete",
      result: "denied",
      ipAddress: ctx.ipAddress,
      surface: "auth",
      meta: { reason },
    });
  });

const denyClaim = <E extends Error>(record: ClaimRow, reason: string, error: E) =>
  Effect.gen(function* () {
    yield* auditClaimDenied(record, reason);
    return yield* Effect.fail(error);
  });

/**
 * Opportunistic GC: drop unclaimed claim records past their TTL. Deleting the
 * (placeholder-owner) org cascades its profile + member + api key + claim row;
 * the placeholder user has no FK to the org, so it is deleted separately
 * (cascading its own member + api key). Claimed records (usedAt set) are
 * excluded, so a real account is never touched. Best-effort and bounded.
 */
const gcExpiredClaims = Effect.gen(function* () {
  const ctx = yield* BaseRequestContextTag;
  const stale = (yield* tryAsync(() =>
    ctx.db
      .select({ organizationId: accountClaims.organizationId, userId: accountClaims.userId })
      .from(accountClaims)
      .where(and(isNull(accountClaims.usedAt), lt(accountClaims.expiresAt, new Date())))
      .limit(25),
  )) as Array<{ organizationId: string; userId: string }>;

  for (const row of stale) {
    yield* tryAsync(() =>
      ctx.db.delete(organization).where(eq(organization.id, row.organizationId)),
    );
    yield* tryAsync(() => ctx.db.delete(user).where(eq(user.id, row.userId)));
  }
}).pipe(Effect.catchAll(() => Effect.void));

const registerAnonymous = Effect.gen(function* () {
  const ctx = yield* BaseRequestContextTag;
  yield* gcExpiredClaims;

  const userId = crypto.randomUUID();
  const claimId = crypto.randomUUID();
  const keyId = crypto.randomUUID();
  const claimToken = generateOpaqueToken(AGENT_CLAIM_PREFIX);
  const claimTokenHash = yield* tryAsync(() => hashApiKey(claimToken));
  const credential = yield* tryAsync(() => generateApiKey(USER_API_KEY_PREFIX));
  const now = new Date();
  const claimExpiresAt = new Date(now.getTime() + AGENT_CLAIM_TTL_MS);
  // Non-routable placeholder address; the real one is bound at claim-complete.
  const placeholderEmail = `acct-${userId}@${UNCLAIMED_ACCOUNT_EMAIL_DOMAIN}`;
  const slug = `account-${crypto.randomUUID().slice(0, 12)}`;

  const seeded = yield* tryAsync(() =>
    ctx.db.transaction(async (tx) => {
      await tx.insert(user).values({
        id: userId,
        email: placeholderEmail,
        name: "Pending owner",
        emailVerified: false,
        createdAt: now,
        updatedAt: now,
      });

      const seed = await seedOrgWithOwnerProfile(tx, {
        userId,
        name: "Personal account (unclaimed)",
        slug,
        metadata: PERSONAL_ORG_METADATA,
        profileName: "default",
        profileExternalId: "default",
      });

      await tx.insert(userApiKeys).values({
        id: keyId,
        userId,
        organizationId: seed.org.id,
        name: "auth.md credential",
        secretHash: credential.hash,
        secretPrefix: credential.prefix,
      });

      await tx.insert(accountClaims).values({
        id: claimId,
        organizationId: seed.org.id,
        userId,
        claimTokenHash,
        expiresAt: claimExpiresAt,
        status: "pending",
      });

      return seed;
    }),
  );

  yield* logBaseAudit({
    organizationId: seeded.org.id,
    userId,
    eventType: "account.register",
    result: "allowed",
    ipAddress: ctx.ipAddress,
    surface: "auth",
    meta: { registrationId: claimId, keyId },
  });

  return {
    registration_id: claimId,
    registration_type: "anonymous" as const,
    credential_type: "api_key" as const,
    credential: credential.key,
    credential_expires: null,
    scopes: [...AGENT_PRECLAIM_SCOPES],
    claim_url: `${apiBase(ctx.env.ABADGE_API_URL)}/agent/auth/claim`,
    claim_token: claimToken,
    claim_token_expires: claimExpiresAt.toISOString(),
    post_claim_scopes: [...AGENT_POSTCLAIM_SCOPES],
  };
});

const loadClaim = (claimToken: string) =>
  Effect.gen(function* () {
    const ctx = yield* BaseRequestContextTag;
    const tokenHash = yield* tryAsync(() => hashApiKey(claimToken));
    const [record] = (yield* tryAsync(() =>
      ctx.db
        .select()
        .from(accountClaims)
        .where(and(eq(accountClaims.claimTokenHash, tokenHash), isNull(accountClaims.usedAt)))
        .limit(1),
    )) as Array<ClaimRow>;

    if (!record) {
      return yield* Effect.fail(invalidClaimToken());
    }
    if (record.expiresAt <= new Date()) {
      return yield* Effect.fail(claimTokenExpired());
    }
    return record;
  });

const claim = (input: AgentClaimInput) =>
  Effect.gen(function* () {
    const ctx = yield* BaseRequestContextTag;
    const record = yield* loadClaim(input.claim_token);

    const otp = generateNumericOtp(6);
    const otpHash = yield* tryAsync(() => hashApiKey(otp));
    const otpExpiresAt = new Date(Date.now() + AGENT_CLAIM_OTP_TTL_MS);

    yield* tryAsync(() =>
      ctx.db
        .update(accountClaims)
        .set({ email: input.email, otpHash, otpExpiresAt, otpAttempts: 0, status: "otp_sent" })
        .where(eq(accountClaims.id, record.id)),
    );

    yield* tryAsync(() =>
      sendEmail(ctx.env, {
        to: input.email,
        subject: "Your abadge account claim code",
        text: `Your abadge claim code is ${otp}\n\nIt expires in 10 minutes. Give it to the agent that requested it. If you didn't expect this, you can ignore this email.`,
      }),
    );

    yield* logBaseAudit({
      organizationId: record.organizationId,
      userId: record.userId,
      eventType: "account.claim",
      result: "allowed",
      ipAddress: ctx.ipAddress,
      surface: "auth",
    });

    return {
      // One claim record per registration, so the attempt handle is its id.
      registration_id: record.id,
      claim_attempt_id: record.id,
      status: "initiated" as const,
      expires_at: otpExpiresAt.toISOString(),
    };
  });

const claimComplete = (input: AgentClaimCompleteInput) =>
  Effect.gen(function* () {
    const ctx = yield* BaseRequestContextTag;
    const record = yield* loadClaim(input.claim_token);

    if (!record.otpHash || !record.email || !record.otpExpiresAt) {
      return yield* denyClaim(
        record,
        "otp_not_requested",
        new BadRequestError({
          code: "OTP_NOT_REQUESTED",
          message: "No claim code has been requested",
          hint: "Call POST /agent/auth/claim with the owner's email first.",
        }),
      );
    }
    if (record.otpExpiresAt <= new Date()) {
      return yield* denyClaim(
        record,
        "otp_expired",
        new BadRequestError({
          code: "OTP_EXPIRED",
          message: "Claim code expired",
          hint: "Request a fresh code via POST /agent/auth/claim.",
        }),
      );
    }
    if (record.otpAttempts >= AGENT_CLAIM_OTP_MAX_ATTEMPTS) {
      return yield* denyClaim(
        record,
        "otp_attempts_exceeded",
        new BadRequestError({
          code: "OTP_ATTEMPTS_EXCEEDED",
          message: "Too many incorrect codes",
          hint: "Request a fresh code via POST /agent/auth/claim.",
        }),
      );
    }

    const otpOk = yield* tryAsync(() => verifyApiKey(input.otp, record.otpHash as string));
    if (!otpOk) {
      // Increment atomically so racing wrong guesses each count toward the cap
      // and can't slip past the max-attempts guard within one rate-limit window.
      yield* tryAsync(() =>
        ctx.db
          .update(accountClaims)
          .set({ otpAttempts: sql`${accountClaims.otpAttempts} + 1` })
          .where(eq(accountClaims.id, record.id)),
      );
      return yield* denyClaim(
        record,
        "otp_invalid",
        new BadRequestError({
          code: "OTP_INVALID",
          message: "Incorrect claim code",
          hint: "Re-read the 6-digit code from the email and try again.",
        }),
      );
    }

    const email = record.email;
    const displayName = email.split("@")[0] || "owner";
    const now = new Date();

    yield* tryAsync(() =>
      ctx.db.transaction(async (tx) => {
        // Single-use guard: only the first completer flips usedAt.
        const [claimed] = (await tx
          .update(accountClaims)
          .set({ usedAt: now, status: "claimed" })
          .where(and(eq(accountClaims.id, record.id), isNull(accountClaims.usedAt)))
          .returning({ id: accountClaims.id })) as Array<{ id: string }>;
        if (!claimed) {
          throw new ConflictError({
            code: "CLAIM_ALREADY_COMPLETED",
            message: "This claim was already completed",
            hint: "The account is already claimed; no further action is needed.",
          });
        }

        // Never silently merge into / take over an existing account.
        const [existing] = (await tx
          .select({ id: user.id })
          .from(user)
          .where(eq(user.email, email))
          .limit(1)) as Array<{ id: string }>;
        if (existing) {
          throw emailInUse();
        }

        // Rebind the placeholder user to the verified human (the OTP proved
        // inbox control). The `abu_` credential is already bound to this user,
        // so its authority is "upgraded in place" to a claimed account.
        await tx
          .update(user)
          .set({ email, name: displayName, emailVerified: true, updatedAt: now })
          .where(eq(user.id, record.userId));
      }),
    ).pipe(
      // Backstop for the select/insert race across separate transactions: a
      // duplicate-email update surfaces as a clean CLAIM_EMAIL_IN_USE.
      Effect.catchIf(
        (e: Error) => isUniqueViolation(e),
        () => Effect.fail(emailInUse()),
      ),
      Effect.tapError((e: Error) =>
        auditClaimDenied(
          record,
          e instanceof ConflictError ? e.code.toLowerCase() : "claim_failed",
        ),
      ),
    );

    // Best-effort: point the new owner at the dashboard to set a password.
    yield* tryAsync(() =>
      sendEmail(ctx.env, {
        to: email,
        subject: "Your abadge account is ready",
        text: `Your abadge personal account is set up and an agent is managing your credentials.\n\nTo access the dashboard, go to ${apiBase(ctx.env.ABADGE_APP_URL)}/login and use "Forgot password" to set a password for ${email}.`,
      }),
    ).pipe(Effect.catchAll(() => Effect.void));

    yield* logBaseAudit({
      organizationId: record.organizationId,
      userId: record.userId,
      eventType: "account.claim_complete",
      result: "allowed",
      ipAddress: ctx.ipAddress,
      surface: "auth",
    });

    return { registration_id: record.id, status: "claimed" as const };
  });

/**
 * auth.md agentic registration — the `anonymous` → user-claimed (OTP) flow. An
 * agent registers an unclaimed personal account and receives an `abu_` personal
 * API key; a human then claims it with an emailed 6-digit code, which binds
 * their verified email to the account. All three procedures are unauthenticated
 * (the agent has no abadge credential before registering).
 */
export const agentRegistrationRouter = createTrpcRouter({
  register: publicProcedure
    .input(strictSchema(AgentRegisterAnonymousSchema))
    .output(strictSchema(AgentRegisterAnonymousResultSchema))
    .mutation(({ ctx }) => runBaseEffect(ctx, registerAnonymous)),
  claim: publicProcedure
    .input(strictSchema(AgentClaimSchema))
    .output(strictSchema(AgentClaimResultSchema))
    .mutation(({ ctx, input }) => runBaseEffect(ctx, claim(input))),
  claimComplete: publicProcedure
    .input(strictSchema(AgentClaimCompleteSchema))
    .output(strictSchema(AgentClaimCompleteResultSchema))
    .mutation(({ ctx, input }) => runBaseEffect(ctx, claimComplete(input))),
});

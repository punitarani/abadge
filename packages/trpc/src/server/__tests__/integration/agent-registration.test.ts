/**
 * Integration coverage for the auth.md agentic-registration flow
 * (`agentAuth.register` / `claim` / `claimComplete`).
 *
 * Exercises the anonymous → user-claimed (OTP) ceremony against real Postgres:
 * the unclaimed-personal-account lifecycle, the `abu_` personal API credential,
 * the emailed OTP, verified-email binding at claim, and the security boundaries
 * (email-in-use rejection, OTP attempt cap, GC of expired unclaimed accounts).
 * Also proves the issued credential actually manages credentials end-to-end
 * (create + owner-reveal via the existing session surface).
 */

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { isPersonalOrg } from "@abadge/core";
import { and, eq, isNull } from "@abadge/db";
import {
  accountClaims,
  auditLogs,
  member,
  organization,
  profiles,
  userApiKeys,
  user as userTable,
} from "@abadge/db/schema";
import type { AppBindings, BaseRequestContext } from "../../context";
import { createTrpcCallerFactory } from "../../init";
import { appRouter } from "../../router";
import { seedUser } from "../helpers/seed";
import { createTestAuth, type TestAuth } from "../helpers/test-auth";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";
import { TEST_ENV } from "../helpers/test-env";

const callerFactory = createTrpcCallerFactory(appRouter);

interface SentEmail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Caller whose env carries a capturing SEND_EMAIL stub (so the test can read
 * the OTP the claim ceremony emails) and an optional bearer token — set it to
 * an `abu_` credential to exercise the management session it authenticates.
 */
function createCaller(
  db: ReturnType<typeof getTestDb>,
  auth: TestAuth,
  sent: SentEmail[],
  bearer?: string,
) {
  const headers = new Headers();
  if (bearer) headers.set("authorization", `Bearer ${bearer}`);

  const env = {
    ...TEST_ENV,
    SEND_EMAIL: {
      send: async (m: { to: string | string[]; subject: string; text?: string }) => {
        sent.push({
          to: Array.isArray(m.to) ? (m.to[0] ?? "") : m.to,
          subject: m.subject,
          text: m.text ?? "",
        });
      },
    },
  } as unknown as AppBindings;

  const ctx: BaseRequestContext = {
    req: new Request("http://test", { headers }),
    resHeaders: new Headers(),
    env,
    validatedEnv: TEST_ENV,
    db,
    auth,
    ipAddress: "127.0.0.1",
  };
  return callerFactory(ctx);
}

function otpFrom(sent: SentEmail[]): string {
  const match = sent
    .map((e) => e.text)
    .join("\n")
    .match(/\b(\d{6})\b/);
  if (!match) throw new Error("no OTP found in captured email");
  return match[1] as string;
}

async function errorCode(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
    return undefined;
  } catch (error: unknown) {
    return (error as { cause?: { code?: string } }).cause?.code;
  }
}

describe("agentAuth (auth.md anonymous → claim flow)", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("register provisions an unclaimed personal account + abu_ credential + claim record", async () => {
    const sent: SentEmail[] = [];
    const reg = await createCaller(db, auth, sent).agentAuth.register({
      type: "anonymous",
      requested_credential_type: "api_key",
    });

    expect(reg.registration_type).toBe("anonymous");
    expect(reg.credential_type).toBe("api_key");
    expect(reg.credential.startsWith("abu_")).toBe(true);
    expect(reg.credential_expires).toBeNull();
    expect(reg.claim_token.startsWith("clm_")).toBe(true);
    expect(reg.scopes).toContain("abadge:account.read");
    expect(reg.post_claim_scopes).toContain("abadge:account.manage");

    const [claimRow] = await db
      .select()
      .from(accountClaims)
      .where(eq(accountClaims.id, reg.registration_id));
    expect(claimRow?.usedAt).toBeNull();
    const orgId = claimRow?.organizationId as string;
    const placeholderUserId = claimRow?.userId as string;

    const [org] = await db.select().from(organization).where(eq(organization.id, orgId));
    expect(isPersonalOrg(org?.metadata)).toBe(true);

    // Placeholder owner — unverified, non-routable synthetic email.
    const [u] = await db.select().from(userTable).where(eq(userTable.id, placeholderUserId));
    expect(u?.emailVerified).toBe(false);
    expect(u?.email.endsWith("@unclaimed.abadge.invalid")).toBe(true);

    const [m] = await db.select().from(member).where(eq(member.organizationId, orgId));
    expect(m?.userId).toBe(placeholderUserId);
    expect(m?.role).toBe("owner");

    const profileRows = await db.select().from(profiles).where(eq(profiles.organizationId, orgId));
    expect(profileRows).toHaveLength(1);
    expect(profileRows[0]?.externalId).toBe("default");

    // The abu_ credential is a user_api_keys row bound to (user, org).
    const keys = await db.select().from(userApiKeys).where(eq(userApiKeys.organizationId, orgId));
    expect(keys).toHaveLength(1);
    expect(keys[0]?.userId).toBe(placeholderUserId);
  });

  test("claim → claimComplete binds the human's verified email in place", async () => {
    const sent: SentEmail[] = [];
    const caller = createCaller(db, auth, sent);
    const reg = await caller.agentAuth.register({});

    const email = `owner-${crypto.randomUUID()}@example.com`;
    const claimRes = await caller.agentAuth.claim({ claim_token: reg.claim_token, email });
    expect(claimRes.status).toBe("initiated");

    const done = await caller.agentAuth.claimComplete({
      claim_token: reg.claim_token,
      otp: otpFrom(sent),
    });
    expect(done.status).toBe("claimed");

    const [claimRow] = await db
      .select()
      .from(accountClaims)
      .where(eq(accountClaims.id, reg.registration_id));
    expect(claimRow?.usedAt).not.toBeNull();

    const [u] = await db.select().from(userTable).where(eq(userTable.email, email));
    expect(u?.id).toBe(claimRow?.userId as string);
    expect(u?.emailVerified).toBe(true);
  });

  test("the abu_ credential can create and owner-reveal credentials in its vault", async () => {
    const sent: SentEmail[] = [];
    const reg = await createCaller(db, auth, sent).agentAuth.register({});

    const session = createCaller(db, auth, sent, reg.credential);
    const created = await session.items.create({
      storageMode: "server_managed",
      payload: { label: "OpenAI", fields: { value: "sk-live-123" } },
    });
    expect(created.id).toBeTruthy();

    const revealed = await session.items.ownerReveal({ itemId: created.id });
    expect(revealed.payload.fields.value).toBe("sk-live-123");
  });

  test("claim is rejected when the email already belongs to a user", async () => {
    const existing = await seedUser(auth);
    const sent: SentEmail[] = [];
    const caller = createCaller(db, auth, sent);
    const reg = await caller.agentAuth.register({});

    await caller.agentAuth.claim({ claim_token: reg.claim_token, email: existing.email });
    const code = await errorCode(() =>
      caller.agentAuth.claimComplete({ claim_token: reg.claim_token, otp: otpFrom(sent) }),
    );
    expect(code).toBe("CLAIM_EMAIL_IN_USE");

    const denials = await db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.eventType, "account.claim_complete"), eq(auditLogs.result, "denied")),
      );
    expect(
      denials.some((d) => (d.meta as { reason?: string })?.reason === "claim_email_in_use"),
    ).toBe(true);
  });

  test("wrong OTP is rejected, counted, and audited", async () => {
    const sent: SentEmail[] = [];
    const caller = createCaller(db, auth, sent);
    const reg = await caller.agentAuth.register({});
    await caller.agentAuth.claim({
      claim_token: reg.claim_token,
      email: `owner-${crypto.randomUUID()}@example.com`,
    });

    const code = await errorCode(() =>
      caller.agentAuth.claimComplete({ claim_token: reg.claim_token, otp: "000000" }),
    );
    expect(code).toBe("OTP_INVALID");

    const [claimRow] = await db
      .select()
      .from(accountClaims)
      .where(eq(accountClaims.id, reg.registration_id));
    expect(claimRow?.otpAttempts).toBe(1);

    const [denial] = await db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.eventType, "account.claim_complete"), eq(auditLogs.result, "denied")),
      );
    expect((denial?.meta as { reason?: string })?.reason).toBe("otp_invalid");
  });

  test("an invalid claim token is rejected", async () => {
    const sent: SentEmail[] = [];
    const code = await errorCode(() =>
      createCaller(db, auth, sent).agentAuth.claim({
        claim_token: "clm_does_not_exist",
        email: "x@example.com",
      }),
    );
    expect(code).toBe("INVALID_CLAIM_TOKEN");
  });

  test("registration GCs expired, unclaimed accounts", async () => {
    const sent: SentEmail[] = [];
    const caller = createCaller(db, auth, sent);
    const stale = await caller.agentAuth.register({});
    const [staleRow] = await db
      .select()
      .from(accountClaims)
      .where(eq(accountClaims.id, stale.registration_id));
    const staleOrgId = staleRow?.organizationId as string;
    const staleUserId = staleRow?.userId as string;

    await db
      .update(accountClaims)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(accountClaims.id, stale.registration_id));

    // The next registration's opportunistic GC should delete the stale account.
    await caller.agentAuth.register({});

    const [goneOrg] = await db.select().from(organization).where(eq(organization.id, staleOrgId));
    expect(goneOrg).toBeUndefined();
    const [goneUser] = await db.select().from(userTable).where(eq(userTable.id, staleUserId));
    expect(goneUser).toBeUndefined();
  });
});

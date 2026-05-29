import { beforeAll, describe, expect, test } from "bun:test";
import { session as sessionTable } from "@abadge/db/schema";
import { seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

// §B — Gating verify for enabling Better Auth session `cookieCache` in
// production (packages/auth/src/server.ts). The optimization is only worth its
// revocation-staleness tradeoff if it ACTUALLY drops the per-request getSession
// DB round-trip in our topology (headers-only getSession reading a cache cookie
// set by the /api/auth path). A code-read isn't enough — this asserts the DB is
// bypassed empirically.
//
// The decisive test: with a valid `session_data` cache cookie present,
// getSession must still resolve the session AFTER its row is deleted from the
// DB — only possible if the DB read was skipped. A negative control (no cache
// cookie) confirms the DB row was otherwise the sole source.
describe("session cookieCache bypasses the DB on getSession (§B)", () => {
  const db = getTestDb();
  // Opt the test auth into the same cookieCache config production now uses.
  const auth = createTestAuth(db, { cookieCacheMaxAgeSeconds: 60 });

  beforeAll(async () => {
    await migrateTestDb();
    await truncateAll();
  });

  /** Extract `better-auth.session_data[...]=value` pairs from a Set-Cookie response. */
  function sessionDataCookiesFrom(res: Response): string[] {
    const setCookies =
      typeof res.headers.getSetCookie === "function"
        ? res.headers.getSetCookie()
        : [res.headers.get("set-cookie") ?? ""];
    return setCookies
      .filter((c) => c.startsWith("better-auth.session_data"))
      .map((c) => c.split(";")[0] ?? "") // keep "name=value", drop attributes
      .filter((c) => c.length > 0);
  }

  test("getSession resolves from the cache cookie after the session row is deleted", async () => {
    const user = await seedUser(auth);
    const sessionTokenCookie = user.headers.get("cookie");
    expect(sessionTokenCookie).toContain("better-auth.session_token=");

    // First getSession is a cache MISS → reads the DB AND writes session_data.
    // asResponse:true surfaces the Set-Cookie so we can capture the cache cookie
    // (and proves the write path fires on the /api/auth response surface).
    const primingRes = (await auth.api.getSession({
      headers: user.headers,
      asResponse: true,
    })) as Response;
    const dataCookies = sessionDataCookiesFrom(primingRes);
    expect(dataCookies.length).toBeGreaterThan(0);

    const cachedHeaders = new Headers();
    // session_token must be present (signature-checked, not DB-checked) for the
    // cache path to engage; session_data carries the cached identity.
    cachedHeaders.set("cookie", [sessionTokenCookie, ...dataCookies].join("; "));

    // Remove every session row: the DB can no longer satisfy getSession.
    await db.delete(sessionTable);

    // Negative control — session_token only, no cache cookie → DB is the sole
    // source, now empty → null. Proves the row really is gone.
    const fromDbOnly = await auth.api.getSession({ headers: user.headers });
    expect(fromDbOnly).toBeNull();

    // Positive — with the cache cookie, getSession still resolves the session.
    // Only possible if the DB read was skipped (the row is deleted).
    const fromCache = (await auth.api.getSession({ headers: cachedHeaders })) as {
      user?: { id?: string };
    } | null;
    expect(fromCache).not.toBeNull();
    expect(fromCache?.user?.id).toBe(user.userId);
  });
});

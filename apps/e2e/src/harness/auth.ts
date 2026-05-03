import { eq } from "@abadge/db";
import { user as userTable } from "@abadge/db/schema";
import { getTestDb } from "./postgres";

export interface SignedUpUser {
  email: string;
  password: string;
  userId: string;
  sessionToken: string;
}

/**
 * Create a verified user via Better Auth's HTTP signup, force email
 * verification through a direct DB update, then sign in to capture the
 * `set-auth-token` bearer-plugin token.
 *
 * Mirrors the flow scripts/pentest-cross-profile.sh uses; doing it this
 * way exercises the full HTTP path (Hono + cors + secureHeaders + better
 * auth + drizzleAdapter) instead of stubbing it.
 */
export async function signupAndLogin(
  apiUrl: string,
  opts: {
    email?: string;
    password?: string;
    name?: string;
  } = {},
): Promise<SignedUpUser> {
  const email = opts.email ?? `e2e-${crypto.randomUUID()}@test.local`;
  const password = opts.password ?? "TestPassword123!";
  const name = opts.name ?? "E2E User";

  const signup = await fetch(`${apiUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name }),
  });
  if (!signup.ok) {
    throw new Error(`sign-up failed (${signup.status}): ${await signup.text()}`);
  }

  // Better Auth requires email verification; the dev send_email binding is
  // best-effort. Force the column directly so sign-in succeeds.
  const db = getTestDb();
  await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.email, email));

  const signin = await fetch(`${apiUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!signin.ok) {
    throw new Error(`sign-in failed (${signin.status}): ${await signin.text()}`);
  }
  const sessionToken = signin.headers.get("set-auth-token");
  if (!sessionToken) {
    throw new Error("sign-in did not return a set-auth-token header");
  }

  const userRow = await db.query.user.findFirst({ where: eq(userTable.email, email) });
  if (!userRow) {
    throw new Error("user row missing after sign-up");
  }

  return { email, password, userId: userRow.id, sessionToken };
}

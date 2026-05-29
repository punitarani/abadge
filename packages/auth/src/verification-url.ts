/**
 * Better Auth builds the verification link as
 * `${baseURL}/verify-email?token=…&callbackURL=<callbackURL || "/">`, where
 * `baseURL` is the API origin (`ABADGE_API_URL`). When no `callbackURL` is
 * supplied at sign-up it defaults to `/`, and the `verify-email` handler — after
 * verifying — redirects the browser to that `callbackURL`. A bare `/` resolves
 * against the API origin, so the user lands on `https://api.abadge.io/`, which
 * has no route and returns the `NOT_FOUND` JSON envelope.
 *
 * Rewrite the `callbackURL` to an absolute URL on the **web app** origin. It is a
 * trusted origin, so Better Auth's `originCheck` on the verify route honours it;
 * on success the user lands on the dashboard sign-in (with `verified=1` so the
 * page can confirm), and on failure Better Auth appends `&error=<code>` to the
 * same URL, which the sign-in page already surfaces.
 *
 * Doing this server-side (in the `sendVerificationEmail` hook) covers every
 * trigger — sign-up, resend, change-email — without each client call site having
 * to remember to pass an absolute `callbackURL`.
 */
export function buildEmailVerificationUrl(rawUrl: string, appUrl: string): string {
  const target = `${appUrl.replace(/\/$/, "")}/login?verified=1`;
  try {
    const url = new URL(rawUrl);
    url.searchParams.set("callbackURL", target);
    return url.toString();
  } catch {
    // `rawUrl` should always be absolute (Better Auth builds it from baseURL).
    // If it ever isn't, return it unchanged rather than break verification.
    return rawUrl;
  }
}

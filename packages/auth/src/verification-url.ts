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
 * If the caller passed a **same-origin relative** `callbackURL` (e.g. an invite
 * flow's `/invite/abc`), carry it through as `redirect=<path>` on the login URL
 * so the destination survives the post-verification sign-in. Absolute/external
 * callbackURLs are still dropped — the open-redirect / origin-spoof guard — and
 * the login page re-sanitizes `redirect` via `normalizeRedirectPath`.
 *
 * Doing this server-side (in the `sendVerificationEmail` hook) covers every
 * trigger — sign-up, resend, change-email — without each client call site having
 * to remember to pass an absolute `callbackURL`.
 */
export function buildEmailVerificationUrl(rawUrl: string, appUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const login = new URL(`${appUrl.replace(/\/$/, "")}/login`);
    login.searchParams.set("verified", "1");
    const redirect = safeRelativeRedirect(url.searchParams.get("callbackURL"));
    if (redirect) {
      login.searchParams.set("redirect", redirect);
    }
    url.searchParams.set("callbackURL", login.toString());
    return url.toString();
  } catch {
    // `rawUrl` should always be absolute (Better Auth builds it from baseURL).
    // If it ever isn't, return it unchanged rather than break verification.
    return rawUrl;
  }
}

/**
 * Accept only same-origin relative paths so an attacker cannot smuggle an
 * external destination through the verification link. Rejects the default `/`
 * (no real destination) and `/login*` (would loop back on itself).
 */
function safeRelativeRedirect(callbackURL: string | null): string | null {
  if (!callbackURL || !callbackURL.startsWith("/") || callbackURL.startsWith("//")) {
    return null;
  }
  if (callbackURL === "/" || callbackURL.startsWith("/login")) {
    return null;
  }
  return callbackURL;
}

import { describe, expect, test } from "bun:test";
import nextConfig from "./next.config";

describe("next redirects", () => {
  test("/install redirects to the raw GitHub installer", async () => {
    const redirects = await nextConfig.redirects?.();

    expect(redirects).toContainEqual({
      source: "/install",
      destination: "https://raw.githubusercontent.com/punitarani/abadge/main/install.sh",
      permanent: false,
    });
  });
});

describe("next headers", () => {
  // Invite tokens (`?token=abi_...`) can sit in the URL on /invite/accept and
  // /join, and are forwarded through /login and /register via `?redirect=`.
  // Without an explicit Referrer-Policy, browsers send the page origin+path as
  // a Referer header on outbound loads, leaking the token to any third-party
  // host (fonts, avatars, analytics) loaded by those pages.
  test.each(["/invite/:path*", "/join", "/login", "/register"] as const)(
    "%s is served with Referrer-Policy: no-referrer",
    async (source) => {
      const headers = await nextConfig.headers?.();

      expect(headers).toContainEqual({
        source,
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      });
    },
  );
});

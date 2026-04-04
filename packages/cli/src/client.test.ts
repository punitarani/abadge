import { afterEach, describe, expect, mock, test } from "bun:test";
import { signInWithEmail, splitCombinedSetCookieHeader } from "./client";

const originalFetch = globalThis.fetch;

function setFetchMock(fetchMock: unknown): void {
  globalThis.fetch = fetchMock as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("splitCombinedSetCookieHeader", () => {
  test("does not split on Expires commas", () => {
    const header = [
      "session=abc; Path=/; HttpOnly; Expires=Thu, 01 Jan 2026 00:00:00 GMT",
      "csrf=def; Path=/; Secure",
    ].join(", ");

    expect(splitCombinedSetCookieHeader(header)).toEqual([
      "session=abc; Path=/; HttpOnly; Expires=Thu, 01 Jan 2026 00:00:00 GMT",
      "csrf=def; Path=/; Secure",
    ]);
  });

  test("does not split on commas inside quoted cookie values", () => {
    const header = ['prefs="theme=light,mode=compact"; Path=/', "session=abc; Path=/"].join(", ");

    expect(splitCombinedSetCookieHeader(header)).toEqual([
      'prefs="theme=light,mode=compact"; Path=/',
      "session=abc; Path=/",
    ]);
  });

  test("uses the sign-in response session when it already contains the user", async () => {
    const fetchMock = mock(
      async () =>
        new Response(JSON.stringify({ user: { id: "user_123", email: "user@example.com" } }), {
          status: 200,
          headers: new Headers({
            "set-cookie": "session=abc; Path=/; HttpOnly",
          }),
        }),
    );
    setFetchMock(fetchMock);

    const result = await signInWithEmail("http://127.0.0.1:8787", "user@example.com", "password");

    expect(result.session.user?.id).toBe("user_123");
    expect(result.sessionCookie).toBe("session=abc");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("falls back to get-session when sign-in omits the user", async () => {
    const fetchMock = mock(async (input: string | URL) => {
      if (String(input).endsWith("/api/auth/sign-in/email")) {
        return new Response(
          JSON.stringify({ session: { id: "session_123", userId: "user_123" } }),
          {
            status: 200,
            headers: new Headers({
              "set-cookie": "session=abc; Path=/; HttpOnly",
            }),
          },
        );
      }

      return new Response(JSON.stringify({ user: { id: "user_123", email: "user@example.com" } }), {
        status: 200,
      });
    });
    setFetchMock(fetchMock);

    const result = await signInWithEmail("http://127.0.0.1:8787", "user@example.com", "password");

    expect(result.session.user?.id).toBe("user_123");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

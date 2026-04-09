import { afterEach, describe, expect, test } from "bun:test";
import { DeviceAuthorizationError, exchangeDeviceToken, requestDeviceCode } from "./client";

const originalFetch = globalThis.fetch;
type FetchInput = Parameters<typeof fetch>[0];

function mockFetch(
  handler: (input: FetchInput, init?: RequestInit) => Response | Promise<Response>,
): void {
  globalThis.fetch = handler as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("device authorization client", () => {
  test("requests a device code with the abadge CLI client id", async () => {
    let requestBody: unknown;
    mockFetch(async (_input, init) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return jsonResponse({
        device_code: "device-123",
        user_code: "ABCD-EFGH",
        verification_uri: "https://app.abadge.io/device",
        verification_uri_complete: "https://app.abadge.io/device?user_code=ABCD-EFGH",
        expires_in: 600,
        interval: 7,
      });
    });

    const result = await requestDeviceCode("https://api.abadge.io/");

    expect(requestBody).toEqual({ client_id: "abadge-cli" });
    expect(result).toMatchObject({
      deviceCode: "device-123",
      userCode: "ABCD-EFGH",
      verificationUri: "https://app.abadge.io/device",
      verificationUriComplete: "https://app.abadge.io/device?user_code=ABCD-EFGH",
      intervalSeconds: 7,
    });
  });

  test("exchanges an approved device code for a bearer session", async () => {
    const calls: Array<{ url: string; body?: unknown; authorization?: string }> = [];
    mockFetch(async (input, init) => {
      calls.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        authorization: init?.headers
          ? (new Headers(init.headers).get("Authorization") ?? undefined)
          : undefined,
      });

      if (String(input).endsWith("/api/auth/device/token")) {
        return jsonResponse({
          access_token: "session-token",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "",
        });
      }

      return jsonResponse({
        session: { id: "session_123", userId: "user_123" },
        user: { id: "user_123", email: "test@example.com" },
      });
    });

    const result = await exchangeDeviceToken("https://api.abadge.io", "device-123", 5);

    expect(calls[0]).toMatchObject({
      url: "https://api.abadge.io/api/auth/device/token",
      body: {
        client_id: "abadge-cli",
        device_code: "device-123",
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      },
    });
    expect(calls[1]).toMatchObject({
      url: "https://api.abadge.io/api/auth/get-session",
      authorization: "Bearer session-token",
    });
    expect(result.accessToken).toBe("session-token");
    expect(result.session.user?.id).toBe("user_123");
  });

  test("surfaces authorization_pending without leaking a token", async () => {
    mockFetch(() =>
      jsonResponse(
        {
          error: "authorization_pending",
          error_description: "Waiting for approval",
        },
        400,
      ),
    );

    const error = await exchangeDeviceToken("https://api.abadge.io", "device-123", 5).catch(
      (err) => err,
    );

    expect(error).toBeInstanceOf(DeviceAuthorizationError);
    expect(error.code).toBe("authorization_pending");
    expect(error.intervalSeconds).toBe(5);
  });

  test("honors slow_down by increasing the next poll interval", async () => {
    mockFetch(() =>
      jsonResponse(
        {
          error: "slow_down",
          error_description: "Polling too frequently",
        },
        400,
      ),
    );

    const error = await exchangeDeviceToken("https://api.abadge.io", "device-123", 5).catch(
      (err) => err,
    );

    expect(error).toBeInstanceOf(DeviceAuthorizationError);
    expect(error.code).toBe("slow_down");
    expect(error.intervalSeconds).toBe(10);
  });

  for (const code of ["access_denied", "expired_token"] as const) {
    test(`surfaces ${code} as a device authorization error`, async () => {
      mockFetch(() =>
        jsonResponse(
          {
            error: code,
            error_description: code,
          },
          400,
        ),
      );

      const error = await exchangeDeviceToken("https://api.abadge.io", "device-123", 5).catch(
        (err) => err,
      );

      expect(error).toBeInstanceOf(DeviceAuthorizationError);
      expect(error.code).toBe(code);
    });
  }
});

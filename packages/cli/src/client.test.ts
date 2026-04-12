import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentApiClient,
  DeviceAuthorizationError,
  exchangeDeviceToken,
  requestDeviceCode,
  resolveSessionConfig,
} from "./client";
import * as configModule from "./config";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
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
  process.env = { ...originalEnv };
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

describe("resolveSessionConfig", () => {
  test("accepts bearer session tokens from the standard session env var", async () => {
    process.env.ABADGE_API_URL = "https://api.abadge.io";
    process.env.ABADGE_SESSION_TOKEN = "session-token";

    await expect(resolveSessionConfig()).resolves.toMatchObject({
      sessionHeaders: { Authorization: "Bearer session-token" },
    });
  });

  test("ignores the legacy operator-token env var in favor of bearer session auth", async () => {
    process.env.ABADGE_API_URL = "https://api.abadge.io";
    process.env.ABADGE_OPERATOR_TOKEN = "abo_test_operator_token";
    process.env.ABADGE_SESSION_TOKEN = "session-token";

    await expect(resolveSessionConfig()).resolves.toMatchObject({
      sessionHeaders: { Authorization: "Bearer session-token" },
    });
  });
});

describe("createAgentApiClient", () => {
  /** Mock fetch to handle tRPC batch calls made during client.connect(). */
  function mockTrpcConnect(): void {
    mockFetch(async (input) => {
      const url = String(input);
      if (url.includes("auth.createChallenge")) {
        return jsonResponse([
          {
            result: {
              data: { challengeId: "chal-1", challenge: "test-challenge" },
            },
          },
        ]);
      }
      if (url.includes("auth.exchangeSession")) {
        return jsonResponse([
          {
            result: {
              data: {
                session: {
                  token: "abs_test_session_token",
                  expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
                },
              },
            },
          },
        ]);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
  }

  test("creates a client from ABADGE_PRIVATE_KEY env var (inline JWK)", async () => {
    const keyPair = (await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

    process.env.ABADGE_API_URL = "https://api.abadge.io";
    process.env.ABADGE_AGENT_ID = "agent-1";
    process.env.ABADGE_PRIVATE_KEY = JSON.stringify(jwk);

    mockTrpcConnect();

    const client = await createAgentApiClient();
    expect(client).toBeDefined();
    client.disconnect();
  });

  test("creates a client from ABADGE_PRIVATE_KEY_PATH env var (file-based JWK)", async () => {
    const keyPair = (await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

    const keyFilePath = join(tmpdir(), `abadge-test-key-${Date.now()}.json`);
    writeFileSync(keyFilePath, JSON.stringify(jwk), { mode: 0o600 });

    process.env.ABADGE_API_URL = "https://api.abadge.io";
    process.env.ABADGE_AGENT_ID = "agent-2";
    process.env.ABADGE_PRIVATE_KEY_PATH = keyFilePath;

    mockTrpcConnect();

    try {
      const client = await createAgentApiClient();
      expect(client).toBeDefined();
      client.disconnect();
    } finally {
      unlinkSync(keyFilePath);
    }
  });

  test("creates a client from ABADGE_AUTH_TOKEN legacy env var", async () => {
    process.env.ABADGE_API_URL = "https://api.abadge.io";
    process.env.ABADGE_AUTH_TOKEN = "abl_legacy_test_token";

    // Mock loadConfig to return null so we test path 4 (env var), not path 3 (config file)
    const spy = spyOn(configModule, "loadConfig").mockReturnValue(null);

    try {
      const client = await createAgentApiClient();
      expect(client).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });

  test("throws a helpful error when no agent credentials are found", async () => {
    // Clear all relevant env vars
    delete process.env.ABADGE_PRIVATE_KEY;
    delete process.env.ABADGE_PRIVATE_KEY_PATH;
    delete process.env.ABADGE_AGENT_ID;
    delete process.env.ABADGE_AUTH_TOKEN;
    delete process.env.ABADGE_API_URL;

    // Mock loadConfig to return null (no config file)
    const spy = spyOn(configModule, "loadConfig").mockReturnValue(null);

    try {
      await expect(createAgentApiClient()).rejects.toThrow("No agent credentials found.");
    } finally {
      spy.mockRestore();
    }
  });
});

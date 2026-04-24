import { describe, expect, mock, test } from "bun:test";
import { makeAllowAllRateLimitStub } from "./test-helpers/rate-limit";
import type { Bindings } from "./types";

mock.module("@abadge/trpc/server", () => ({
  handleTrpcRequest: () => new Response("mock trpc"),
}));

const { default: app } = await import("./index");

const testEnv: Bindings = {
  ABADGE_API_URL: "http://localhost:8787",
  ABADGE_APP_URL: "http://localhost:3000",
  ENCRYPTION_KEY: "test-encryption-key",
  BETTER_AUTH_SECRET: "test-better-auth-secret",
  GOOGLE_CLIENT_ID: "test-google-client-id",
  GOOGLE_CLIENT_SECRET: "test-google-client-secret",
  GITHUB_CLIENT_ID: "test-github-client-id",
  GITHUB_CLIENT_SECRET: "test-github-client-secret",
  RATE_LIMIT: makeAllowAllRateLimitStub(),
  SEND_EMAIL: { send: async () => {} } as unknown as SendEmail,
};

describe("api app", () => {
  test("GET /health returns ok", async () => {
    const response = await app.request("http://localhost/health", undefined, testEnv);
    const body = (await response.json()) as { status: string };

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });

  test("tRPC endpoint is reachable", async () => {
    const response = await app.request("http://localhost/trpc/health", undefined, testEnv);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("mock trpc");
  });

  test("unknown v1 routes return 404", async () => {
    const response = await app.request("http://localhost/v1/agents", undefined, testEnv);

    expect(response.status).toBe(404);
  });
});

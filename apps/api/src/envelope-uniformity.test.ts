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

type AnyObject = Record<string, unknown>;

describe("Envelope uniformity (§ENV2)", () => {
  test("§ENV2c — Hono 404 returns canonical envelope", async () => {
    const res = await app.request("http://localhost/nonexistent-route-xyz", undefined, testEnv);
    expect(res.status).toBe(404);
    const body = (await res.json()) as AnyObject;
    expect(body).toMatchObject({
      code: "NOT_FOUND",
      message: expect.any(String),
      hint: expect.any(String),
      meta: expect.objectContaining({ path: "/nonexistent-route-xyz" }),
    });
  });

  test("§ENV2c — Hono 404 on POST includes method in meta", async () => {
    const res = await app.request("http://localhost/bogus", { method: "POST" }, testEnv);
    expect(res.status).toBe(404);
    const body = (await res.json()) as AnyObject;
    expect(body.code).toBe("NOT_FOUND");
    expect((body.meta as AnyObject | undefined)?.method).toBe("POST");
  });
});

import { describe, expect, test } from "bun:test";
import app from "./index";
import type { Bindings } from "./types";

const testEnv: Bindings = {
  API_URL: "http://localhost:8787",
  APP_URL: "http://localhost:3000",
  ENCRYPTION_KEY: "test-encryption-key",
  BETTER_AUTH_URL: "http://localhost:8787",
  BETTER_AUTH_SECRET: "test-better-auth-secret",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  GITHUB_CLIENT_ID: "",
  GITHUB_CLIENT_SECRET: "",
};

describe("api app", () => {
  test("GET /health returns ok", async () => {
    const response = await app.request("http://localhost/health", undefined, testEnv);
    const body = (await response.json()) as { status: string };

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });
});

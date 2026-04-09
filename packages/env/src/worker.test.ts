import { describe, expect, it } from "bun:test";
import { validateWorkerEnv } from "./worker";

const validWorkerEnv = {
  ABADGE_API_URL: "https://api.abadge.io",
  ABADGE_APP_URL: "https://abadge.io",
  ENCRYPTION_KEY: "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=",
  BETTER_AUTH_SECRET: "test-better-auth-secret",
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  GITHUB_CLIENT_ID: "github-client-id",
  GITHUB_CLIENT_SECRET: "github-client-secret",
} satisfies Record<string, string>;

describe("validateWorkerEnv", () => {
  it("requires every configured OAuth secret", () => {
    expect(() =>
      validateWorkerEnv({
        ABADGE_API_URL: validWorkerEnv.ABADGE_API_URL,
        ABADGE_APP_URL: validWorkerEnv.ABADGE_APP_URL,
        ENCRYPTION_KEY: validWorkerEnv.ENCRYPTION_KEY,
        BETTER_AUTH_SECRET: validWorkerEnv.BETTER_AUTH_SECRET,
      }),
    ).toThrow();
  });

  it("accepts a complete worker environment", () => {
    expect(validateWorkerEnv(validWorkerEnv)).toEqual(validWorkerEnv);
  });
});

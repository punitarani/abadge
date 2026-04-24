import { describe, expect, it } from "bun:test";
import type { Database } from "@abadge/db";
import { createAuth, getTrustedOrigins } from "./server";

describe("getTrustedOrigins", () => {
  it("includes localhost origins in dev when URLs are localhost", () => {
    const origins = getTrustedOrigins({
      ABADGE_API_URL: "http://localhost:8787",
      ABADGE_APP_URL: "http://localhost:3000",
    });
    expect(origins).toContain("http://localhost:8787");
    expect(origins).toContain("http://localhost:3000");
    expect(origins).toContain("http://localhost:3001");
  });

  it("excludes localhost origins in production", () => {
    const origins = getTrustedOrigins({
      ABADGE_API_URL: "https://api.abadge.io",
      ABADGE_APP_URL: "https://abadge.io",
    });
    expect(origins).toContain("https://api.abadge.io");
    expect(origins).toContain("https://abadge.io");
    expect(origins).not.toContain("http://localhost:3000");
    expect(origins).not.toContain("http://localhost:3001");
  });

  it("deduplicates origins", () => {
    const origins = getTrustedOrigins({
      ABADGE_API_URL: "http://localhost:8787",
      ABADGE_APP_URL: "http://localhost:3000",
    });
    const count = origins.filter((o) => o === "http://localhost:3000").length;
    expect(count).toBe(1);
  });
});

describe("createAuth", () => {
  const TEST_ENV = {
    ABADGE_API_URL: "https://api.abadge.io",
    ABADGE_APP_URL: "https://abadge.io",
    BETTER_AUTH_SECRET: "12345678901234567890123456789012",
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    GITHUB_CLIENT_ID: "github-client-id",
    GITHUB_CLIENT_SECRET: "github-client-secret",
    // Stub the CF Email binding — tests never actually send email.
    SEND_EMAIL: { send: async () => {} },
  } as const;

  it("configures both required social providers", () => {
    const auth = createAuth({} as Database, TEST_ENV);

    expect(auth.options.socialProviders).toEqual({
      google: {
        clientId: "google-client-id",
        clientSecret: "google-client-secret",
      },
      github: {
        clientId: "github-client-id",
        clientSecret: "github-client-secret",
      },
    });
  });

  // Migration 0006 drops the `apikey` table. Any request routed to the Better
  // Auth apiKey plugin would crash at runtime with `relation "apikey" does not
  // exist`. v0 uses the `agents` table for all agent credentials.
  it("does not register the Better Auth apiKey plugin", () => {
    const auth = createAuth({} as Database, TEST_ENV);

    const pluginIds = (auth.options.plugins ?? []).map((p: { id?: string }) => p.id ?? "");
    expect(pluginIds).not.toContain("api-key");

    // The plugin exposes `auth.api.verifyApiKey` / `createApiKey` /
    // `listApiKeys`. None of these should exist on the auth instance.
    expect(auth.api.verifyApiKey).toBeUndefined();
    expect(auth.api.createApiKey).toBeUndefined();
    expect(auth.api.listApiKeys).toBeUndefined();
  });

  // §AU1: email must be verified before sign-in is allowed.
  it("requires email verification (§AU1)", () => {
    const auth = createAuth({} as Database, TEST_ENV);
    expect(auth.options.emailAndPassword.requireEmailVerification).toBe(true);
  });

  // §AU1: password reset callback must be wired to email send.
  it("has sendResetPassword configured", () => {
    const auth = createAuth({} as Database, TEST_ENV);
    expect(typeof auth.options.emailAndPassword.sendResetPassword).toBe("function");
  });

  // §AU1: email verification callback must be wired to email send.
  it("has sendVerificationEmail configured", () => {
    const auth = createAuth({} as Database, TEST_ENV);
    expect(typeof auth.options.emailVerification?.sendVerificationEmail).toBe("function");
  });

  // B36: OAuth pre-claim takeover is blocked by disabling implicit account linking.
  it("disables implicit OAuth account linking (B36)", () => {
    const auth = createAuth({} as Database, TEST_ENV);
    expect(auth.options.account?.accountLinking?.disableImplicitLinking).toBe(true);
  });
});

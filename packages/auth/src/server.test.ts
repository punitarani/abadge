import { describe, expect, it } from "bun:test";
import type { Database } from "@abadge/db";
import { createAuth, getTrustedOrigins } from "./server";

describe("getTrustedOrigins", () => {
  it("includes ABADGE API and app URLs plus localhost origins", () => {
    const origins = getTrustedOrigins({
      ABADGE_API_URL: "https://api.abadge.io",
      ABADGE_APP_URL: "https://abadge.io",
    });
    expect(origins).toContain("https://api.abadge.io");
    expect(origins).toContain("https://abadge.io");
    expect(origins).toContain("http://localhost:3000");
    expect(origins).toContain("http://localhost:3001");
  });
});

describe("createAuth", () => {
  it("configures both required social providers", () => {
    const auth = createAuth({} as Database, {
      ABADGE_API_URL: "https://api.abadge.io",
      ABADGE_APP_URL: "https://abadge.io",
      BETTER_AUTH_SECRET: "12345678901234567890123456789012",
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret",
      GITHUB_CLIENT_ID: "github-client-id",
      GITHUB_CLIENT_SECRET: "github-client-secret",
    });

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
});

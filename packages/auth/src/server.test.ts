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

import { describe, expect, it } from "bun:test";
import type { AuthEnv } from "./server";
import { getEnabledSocialProviders } from "./server";

const baseEnv: AuthEnv = {
  API_URL: "http://localhost:8787",
  APP_URL: "http://localhost:3000",
  BETTER_AUTH_URL: "http://localhost:8787",
  BETTER_AUTH_SECRET: "secret",
};

describe("getEnabledSocialProviders", () => {
  it("returns an empty list when no social credentials are configured", () => {
    expect(getEnabledSocialProviders(baseEnv)).toEqual([]);
  });

  it("returns only github when github credentials are configured", () => {
    expect(
      getEnabledSocialProviders({
        ...baseEnv,
        GITHUB_CLIENT_ID: "github-id",
        GITHUB_CLIENT_SECRET: "github-secret",
      }),
    ).toEqual(["github"]);
  });

  it("returns github and google when both providers are configured", () => {
    expect(
      getEnabledSocialProviders({
        ...baseEnv,
        GITHUB_CLIENT_ID: "github-id",
        GITHUB_CLIENT_SECRET: "github-secret",
        GOOGLE_CLIENT_ID: "google-id",
        GOOGLE_CLIENT_SECRET: "google-secret",
      }),
    ).toEqual(["github", "google"]);
  });
});

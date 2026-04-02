import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";

import { buildSecretPayload, parseRequiredSecretsFromWranglerConfig } from "./sync-worker-secrets";

const repoRoot = resolve(import.meta.dir, "..");

const readWranglerRequiredSecrets = async (relativePath: string) => {
  const text = await Bun.file(resolve(repoRoot, relativePath)).text();
  return parseRequiredSecretsFromWranglerConfig(text);
};

describe("sync-worker-secrets", () => {
  it("parses required keys from wrangler config", () => {
    expect(
      parseRequiredSecretsFromWranglerConfig(
        '{ "secrets": { "required": ["ABADGE_API_URL", "ABADGE_APP_URL"] } }',
      ),
    ).toEqual(["ABADGE_API_URL", "ABADGE_APP_URL"]);
  });

  it("rejects duplicate keys", () => {
    expect(() =>
      parseRequiredSecretsFromWranglerConfig('{ "secrets": { "required": ["FOO", "FOO"] } }'),
    ).toThrow('Duplicate worker secret key "FOO"');
  });

  it("builds a payload from required env vars", () => {
    expect(
      buildSecretPayload(
        {
          ABADGE_API_URL: "https://api.abadge.io",
          ABADGE_APP_URL: "https://abadge.io",
        },
        ["ABADGE_API_URL", "ABADGE_APP_URL"],
      ),
    ).toEqual({
      ABADGE_API_URL: "https://api.abadge.io",
      ABADGE_APP_URL: "https://abadge.io",
    });
  });

  it("fails when a required env var is missing", () => {
    expect(() =>
      buildSecretPayload(
        {
          ABADGE_API_URL: "https://api.abadge.io",
        },
        ["ABADGE_API_URL", "ABADGE_APP_URL"],
      ),
    ).toThrow("Missing required worker secrets in environment: ABADGE_APP_URL");
  });
});

describe("worker required secrets", () => {
  it("uses canonical ABADGE names for the API worker", async () => {
    const requiredSecrets = await readWranglerRequiredSecrets("apps/api/wrangler.jsonc");

    expect(requiredSecrets).toContain("ABADGE_API_URL");
    expect(requiredSecrets).toContain("ABADGE_APP_URL");
  });

  it("uses canonical ABADGE names for the web worker", async () => {
    const requiredSecrets = await readWranglerRequiredSecrets("apps/web/wrangler.jsonc");

    expect(requiredSecrets).toEqual(["ABADGE_API_URL", "ABADGE_APP_URL"]);
  });

  it("never uses NEXT_PUBLIC names for worker secret sync", async () => {
    const apiKeys = await readWranglerRequiredSecrets("apps/api/wrangler.jsonc");
    const webKeys = await readWranglerRequiredSecrets("apps/web/wrangler.jsonc");

    expect([...apiKeys, ...webKeys].every((key) => !key.startsWith("NEXT_PUBLIC_"))).toBe(true);
  });
});

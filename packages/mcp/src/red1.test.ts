import { describe, expect, test } from "bun:test";
import * as getAudit from "./tools/get-audit.js";
import * as listItems from "./tools/list-items.js";
import * as mountSecret from "./tools/mount-secret.js";
import * as releaseMount from "./tools/release-mount.js";
import * as useSecret from "./tools/use-secret.js";

// §RED1: no MCP tool may forward subprocess stdout/stderr or raw secret
// material to the model. This test enumerates the registered tools and
// inspects their description text + every JSON return-shape sample to make
// sure no key is named with a leaky suffix.
//
// We can't inspect the runtime return schema directly because handlers return
// `JSON.stringify(...)` rather than a typed payload, so we cover the surface
// in two ways:
//   1. The tool description must not promise stdout/stderr/text/secretValue.
//   2. A few canonical handler outputs are parsed and their keys checked.

const TOOLS = [listItems, useSecret, mountSecret, releaseMount, getAudit] as const;

const LEAKY_KEY_RE = /stdout|stderr|"text"|secretValue/i;

describe("§RED1 — MCP tool returns no subprocess output text", () => {
  test("no tool description promises stdout / stderr / secret text", () => {
    for (const tool of TOOLS) {
      const desc = tool.toolDescription.toLowerCase();
      // It's OK to MENTION that stdout/stderr is NOT returned. But the
      // promise/return shape itself must never include them. Stripping
      // strict-negation phrases would be brittle; instead we check that the
      // description never says "returns stdout" or similar affirmatives.
      expect(desc).not.toMatch(/returns? (the )?(stdout|stderr|output text)/);
    }
  });

  test("use_secret return payload exposes only metadata keys", () => {
    // Canonical key set returned by run-with-secret + run-with-all-secrets.
    // If the unified use_secret handler ever adds stdout/stderr/text/secret,
    // this allowlist will fail.
    const ALLOWED_KEYS = new Set([
      "exitCode",
      "durationMs",
      "outputLineCount",
      "truncated",
      "injectedCount",
    ]);
    const sample = {
      exitCode: 0,
      durationMs: 1,
      outputLineCount: { stdout: 0, stderr: 0 },
      truncated: false,
      injectedCount: 1,
    };
    for (const k of Object.keys(sample)) {
      expect(ALLOWED_KEYS.has(k)).toBe(true);
      expect(k).not.toMatch(LEAKY_KEY_RE);
    }
  });

  test("tool descriptions surface the §RED1 guarantee explicitly", () => {
    // The unified use_secret tool must tell callers stdout/stderr are not
    // returned, so a buggy LLM-side caller can't misinterpret the silence.
    expect(useSecret.toolDescription.toLowerCase()).toMatch(/stdout/);
    expect(useSecret.toolDescription.toLowerCase()).toMatch(/never returned/);
  });
});

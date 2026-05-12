import { describe, expect, test } from "bun:test";
import type { McpConfig } from "../config.js";
import { handler, toolInputSchema, toolName } from "./use-secret";

describe("use_secret tool", () => {
  test("registers under the canonical name 'use_secret'", () => {
    expect(toolName).toBe("use_secret");
  });

  test("rejects 0 targets (no itemId, no profileId)", async () => {
    const config = {} as McpConfig;
    await expect(
      handler(
        toolInputSchema.parse({
          command: "echo",
          args: ["hi"],
        }),
        config,
      ),
    ).rejects.toThrow(/exactly one of itemId/);
  });

  test("rejects 2 targets (itemId + profileId)", async () => {
    const config = {} as McpConfig;
    await expect(
      handler(
        toolInputSchema.parse({
          itemId: "i1",
          profileId: "p1",
          command: "echo",
        }),
        config,
      ),
    ).rejects.toThrow(/exactly one of itemId/);
  });

  test("rejects reserved env var name before any work", async () => {
    const config = {} as McpConfig;
    await expect(
      handler(
        toolInputSchema.parse({
          itemId: "i1",
          command: "echo",
          envVarName: "PATH",
        }),
        config,
      ),
    ).rejects.toThrow(/reserved env var/);
  });

  test("rejects malformed env var name", async () => {
    const config = {} as McpConfig;
    await expect(
      handler(
        toolInputSchema.parse({
          itemId: "i1",
          command: "echo",
          envVarName: "lower_case",
        }),
        config,
      ),
    ).rejects.toThrow(/Invalid env var name/);
  });

  // Regression for PR4 review C2: the tool MUST NOT advertise
  // `profileLabel` / `profileExternalId` inputs until PR 5 ships the
  // server-side externalId lookup. Advertising them without the lookup
  // routes label/externalId strings straight to bulkAccessMountEnv (which
  // expects a UUID) and surfaces a confusing PROFILE_NOT_FOUND instead of
  // a "this field isn't wired yet" error.
  test("schema does NOT expose profileLabel or profileExternalId (PR 5 territory)", () => {
    const shape = toolInputSchema.shape as Record<string, unknown>;
    expect("profileLabel" in shape).toBe(false);
    expect("profileExternalId" in shape).toBe(false);
    expect("profileId" in shape).toBe(true);
    expect("itemId" in shape).toBe(true);
  });
});

import { describe, expect, test } from "bun:test";
import type { McpConfig } from "../config.js";
import { handler, toolInputSchema, toolName } from "./use-secret";

describe("use_secret tool", () => {
  test("registers under the canonical name 'use_secret'", () => {
    expect(toolName).toBe("use_secret");
  });

  test("rejects 0 targets (no itemId, no profileLabel, no profileExternalId)", async () => {
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

  test("rejects 2 targets (itemId + profileLabel)", async () => {
    const config = {} as McpConfig;
    await expect(
      handler(
        toolInputSchema.parse({
          itemId: "i1",
          profileLabel: "p1",
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
});

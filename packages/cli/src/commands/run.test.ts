import { describe, expect, test } from "bun:test";
import { type AbadgeAgentClient, AbadgeApiError } from "@abadge/sdk";
import { errorMessage } from "../output";
import { runWithExpandEnv } from "./run";

describe("runWithExpandEnv", () => {
  test("propagates AbadgeApiError with hint intact when accessMount fails", async () => {
    const apiErr = new AbadgeApiError(
      403,
      "PERMISSION_DENIED",
      "Agent lacks mount_env capability for item_123",
      "Grant mount_env via: abadge permission grant --agent agt_1 --item item_123 --capability mount_env",
    );
    const client = {
      accessMount: async () => {
        throw apiErr;
      },
    } as unknown as AbadgeAgentClient;

    let caught: unknown;
    try {
      await runWithExpandEnv(client, "item_123", "echo", []);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AbadgeApiError);
    expect((caught as AbadgeApiError).code).toBe("PERMISSION_DENIED");
    expect((caught as AbadgeApiError).hint).toContain("Grant mount_env");

    // End-to-end: the CLI's error renderer shows the hint.
    const rendered = errorMessage(caught, "Failed to run command.");
    expect(rendered).toContain("Agent lacks mount_env capability");
    expect(rendered).toContain("Grant mount_env");
  });
});

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

describe("runWithAll", () => {
  test("propagates AbadgeApiError with hint intact when bulk fetch is denied", async () => {
    const apiErr = new AbadgeApiError(
      403,
      "PERMISSION_DENIED",
      "Remote agents cannot bulk-mount env vars",
      "Run the agent locally to use --all, or use access.reveal per-item remotely.",
    );
    const client = {
      bulkAccessMountEnv: async () => {
        throw apiErr;
      },
    } as unknown as AbadgeAgentClient;

    const { runWithAll } = await import("./run");
    let caught: unknown;
    try {
      await runWithAll(client, "prof_xyz", "echo", []);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AbadgeApiError);
    expect((caught as AbadgeApiError).code).toBe("PERMISSION_DENIED");
    const rendered = errorMessage(caught, "Failed to run command.");
    expect(rendered).toContain("Remote agents cannot");
    expect(rendered).toContain("Run the agent locally");
  });

  test("propagates PROFILE_NOT_FOUND with hint", async () => {
    const apiErr = new AbadgeApiError(
      404,
      "PROFILE_NOT_FOUND",
      "Profile not found",
      "Confirm the profileId belongs to the agent's organization.",
    );
    const client = {
      bulkAccessMountEnv: async () => {
        throw apiErr;
      },
    } as unknown as AbadgeAgentClient;

    const { runWithAll } = await import("./run");
    let caught: unknown;
    try {
      await runWithAll(client, "prof_missing", "echo", []);
    } catch (err) {
      caught = err;
    }

    expect((caught as AbadgeApiError).code).toBe("PROFILE_NOT_FOUND");
    const rendered = errorMessage(caught, "Failed to run command.");
    expect(rendered).toContain("Profile not found");
    expect(rendered).toContain("agent's organization");
  });
});

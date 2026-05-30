import { describe, expect, test } from "bun:test";
import { buildPermissionDeniedHint, buildPermissionDeniedMeta } from "./denial-hint";

describe("buildPermissionDeniedHint", () => {
  test("names the human actor and the agent cannot self-grant", () => {
    const hint = buildPermissionDeniedHint({});
    expect(hint).toContain("A person with management access must grant this");
    expect(hint).toContain("dashboard Permissions page");
    expect(hint).toContain("The agent cannot grant its own access.");
  });

  test("interpolates a copy-pasteable command when all identifiers are known", () => {
    const hint = buildPermissionDeniedHint({
      agentId: "agent_123",
      itemId: "item_456",
      capability: "reveal_plaintext",
    });
    expect(hint).toContain(
      "abadge permission create --agent-id agent_123 --item-id item_456 --capability reveal_plaintext",
    );
  });

  test("interpolates canonical actions as the --capability value", () => {
    // `abadge permission create --capability` accepts canonical read/use, so
    // the pipeline's action value is a valid paste target.
    const hint = buildPermissionDeniedHint({
      agentId: "agent_1",
      itemId: "item_1",
      capability: "use",
    });
    expect(hint).toContain("--capability use");
  });

  test("falls back to placeholder command when identifiers are missing", () => {
    const hint = buildPermissionDeniedHint({ itemId: "item_1" });
    expect(hint).toContain("--agent-id <id> --item-id <id> --capability <cap>");
    expect(hint).not.toContain("item_1");
  });
});

describe("buildPermissionDeniedMeta", () => {
  test("includes only the known identifiers", () => {
    const meta = buildPermissionDeniedMeta({
      agentId: "agent_1",
      itemId: "item_1",
      capability: "read",
      action: "read",
    });
    expect(meta).toEqual({
      agentId: "agent_1",
      itemId: "item_1",
      capability: "read",
      action: "read",
    });
  });

  test("drops unknown fields rather than emitting undefined keys", () => {
    const meta = buildPermissionDeniedMeta({ itemId: "item_1" });
    expect(meta).toEqual({ itemId: "item_1" });
    expect(Object.hasOwn(meta, "agentId")).toBe(false);
    expect(Object.hasOwn(meta, "capability")).toBe(false);
  });
});

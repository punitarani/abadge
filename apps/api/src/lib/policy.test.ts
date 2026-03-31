import { describe, expect, test } from "bun:test";
import { deliveryModes } from "@abadge/core";
import { type AccessRequest, compareSensitivity, evaluatePolicy, type PolicyInput } from "./policy";

const baseRequest: AccessRequest = {
  deliveryMode: "env_inject",
  sensitivity: "medium",
};

describe("evaluatePolicy", () => {
  test("no active policies → allowed with all delivery modes", () => {
    const result = evaluatePolicy([], baseRequest);
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
    expect(result.effectiveDeliveryModes).toEqual([...deliveryModes]);
  });

  test("disabled policy is ignored", () => {
    const policies: PolicyInput[] = [
      { enabled: false, rules: [{ type: "delivery_mode", deliveryModes: ["env_inject"] }] },
    ];
    const result = evaluatePolicy(policies, baseRequest);
    expect(result.allowed).toBe(true);
    expect(result.effectiveDeliveryModes).toEqual([...deliveryModes]);
  });

  test("delivery_mode rule restricts modes — allowed mode passes", () => {
    const policies: PolicyInput[] = [
      { enabled: true, rules: [{ type: "delivery_mode", deliveryModes: ["env_inject"] }] },
    ];
    const result = evaluatePolicy(policies, { ...baseRequest, deliveryMode: "env_inject" });
    expect(result.allowed).toBe(true);
    expect(result.effectiveDeliveryModes).toEqual(["env_inject"]);
  });

  test("delivery_mode rule restricts modes — blocked mode denied", () => {
    const policies: PolicyInput[] = [
      { enabled: true, rules: [{ type: "delivery_mode", deliveryModes: ["env_inject"] }] },
    ];
    const result = evaluatePolicy(policies, { ...baseRequest, deliveryMode: "reveal" });
    expect(result.allowed).toBe(false);
  });

  test("environment rule — wrong environment denied", () => {
    const policies: PolicyInput[] = [
      { enabled: true, rules: [{ type: "environment", environments: ["prod"] }] },
    ];
    const result = evaluatePolicy(policies, { ...baseRequest, environment: "dev" });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("environment not allowed by policy");
  });

  test("environment rule — correct environment allowed", () => {
    const policies: PolicyInput[] = [
      { enabled: true, rules: [{ type: "environment", environments: ["prod"] }] },
    ];
    const result = evaluatePolicy(policies, { ...baseRequest, environment: "prod" });
    expect(result.allowed).toBe(true);
  });

  test("environment rule — null environment passes", () => {
    const policies: PolicyInput[] = [
      { enabled: true, rules: [{ type: "environment", environments: ["prod"] }] },
    ];
    const result = evaluatePolicy(policies, { ...baseRequest, environment: null });
    expect(result.allowed).toBe(true);
  });

  test("sensitivity rule with requiresApproval — high sensitivity triggers approval", () => {
    const policies: PolicyInput[] = [
      {
        enabled: true,
        rules: [{ type: "sensitivity", sensitivity: "high", requiresApproval: true }],
      },
    ];
    const result = evaluatePolicy(policies, { ...baseRequest, sensitivity: "critical" });
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(true);
  });

  test("sensitivity rule with requiresApproval — low sensitivity does not trigger", () => {
    const policies: PolicyInput[] = [
      {
        enabled: true,
        rules: [{ type: "sensitivity", sensitivity: "high", requiresApproval: true }],
      },
    ];
    const result = evaluatePolicy(policies, { ...baseRequest, sensitivity: "low" });
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  test("destination rule — blocked destination denied", () => {
    const policies: PolicyInput[] = [
      {
        enabled: true,
        rules: [{ type: "destination", blockedDestinations: ["evil.com"] }],
      },
    ];
    const result = evaluatePolicy(policies, { ...baseRequest, destination: "evil.com" });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("destination is blocked by policy");
  });

  test("destination rule — allowed destination passes", () => {
    const policies: PolicyInput[] = [
      {
        enabled: true,
        rules: [{ type: "destination", destinations: ["api.example.com"] }],
      },
    ];
    const result = evaluatePolicy(policies, { ...baseRequest, destination: "api.example.com" });
    expect(result.allowed).toBe(true);
  });

  test("destination rule — no destination passes any rule", () => {
    const policies: PolicyInput[] = [
      {
        enabled: true,
        rules: [{ type: "destination", blockedDestinations: ["evil.com"] }],
      },
    ];
    const result = evaluatePolicy(policies, { ...baseRequest, destination: null });
    expect(result.allowed).toBe(true);
  });

  test("ttl rule — session TTL exceeds max denied", () => {
    const policies: PolicyInput[] = [{ enabled: true, rules: [{ type: "ttl", ttlSeconds: 3600 }] }];
    const result = evaluatePolicy(policies, { ...baseRequest, sessionTtlSeconds: 7200 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("exceeds policy max");
  });

  test("multiple rules compose — delivery_mode + environment both must pass", () => {
    const policies: PolicyInput[] = [
      {
        enabled: true,
        rules: [
          { type: "delivery_mode", deliveryModes: ["env_inject"] },
          { type: "environment", environments: ["prod"] },
        ],
      },
    ];
    const result = evaluatePolicy(policies, {
      ...baseRequest,
      deliveryMode: "env_inject",
      environment: "prod",
    });
    expect(result.allowed).toBe(true);
    expect(result.effectiveDeliveryModes).toEqual(["env_inject"]);
  });

  test("multiple rules compose — one fails, request denied", () => {
    const policies: PolicyInput[] = [
      {
        enabled: true,
        rules: [
          { type: "delivery_mode", deliveryModes: ["env_inject"] },
          { type: "environment", environments: ["prod"] },
        ],
      },
    ];
    const result = evaluatePolicy(policies, {
      ...baseRequest,
      deliveryMode: "env_inject",
      environment: "dev",
    });
    expect(result.allowed).toBe(false);
  });
});

describe("compareSensitivity", () => {
  test("low < medium < high < critical", () => {
    expect(compareSensitivity("low", "medium")).toBe(-1);
    expect(compareSensitivity("medium", "high")).toBe(-1);
    expect(compareSensitivity("high", "critical")).toBe(-1);
  });

  test("equal sensitivities return 0", () => {
    expect(compareSensitivity("high", "high")).toBe(0);
  });

  test("higher > lower returns 1", () => {
    expect(compareSensitivity("critical", "low")).toBe(1);
  });
});

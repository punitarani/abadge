import { deliveryModes, type Sensitivity, sensitivities } from "@abadge/core";

/** Matches PolicyRuleSchema field names from packages/core/src/schemas.ts */
export interface PolicyRule {
  type: "delivery_mode" | "environment" | "sensitivity" | "destination" | "ttl";
  deliveryModes?: string[];
  environments?: string[];
  sensitivity?: string;
  requiresApproval?: boolean;
  destinations?: string[];
  blockedDestinations?: string[];
  ttlSeconds?: number;
}

export interface PolicyInput {
  rules: PolicyRule[];
  enabled: boolean;
}

export interface AccessRequest {
  deliveryMode: string;
  environment?: string | null;
  destination?: string | null;
  sensitivity: string;
  credentialAllowedDeliveryModes?: string[] | null;
  grantAllowedDeliveryModes?: string[] | null;
  sessionTtlSeconds?: number;
}

export interface PolicyResult {
  allowed: boolean;
  reason: string;
  requiresApproval: boolean;
  effectiveDeliveryModes: string[];
}

const sensitivityOrder: Record<Sensitivity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export function compareSensitivity(a: string, b: string): number {
  const aIndex = sensitivityOrder[a as Sensitivity] ?? -1;
  const bIndex = sensitivityOrder[b as Sensitivity] ?? -1;
  if (aIndex < bIndex) return -1;
  if (aIndex > bIndex) return 1;
  return 0;
}

function intersect(a: string[], b: string[]): string[] {
  const set = new Set(b);
  return a.filter((v) => set.has(v));
}

const denied = (reason: string): PolicyResult => ({
  allowed: false,
  reason,
  requiresApproval: false,
  effectiveDeliveryModes: [],
});

function evaluateEnvironmentRule(rule: PolicyRule, request: AccessRequest): PolicyResult | null {
  if (
    rule.environments &&
    request.environment != null &&
    !rule.environments.includes(request.environment)
  ) {
    return denied("environment not allowed by policy");
  }
  return null;
}

function evaluateDestinationRule(rule: PolicyRule, request: AccessRequest): PolicyResult | null {
  if (request.destination == null) return null;
  if (rule.blockedDestinations?.includes(request.destination)) {
    return denied("destination is blocked by policy");
  }
  if (rule.destinations && !rule.destinations.includes(request.destination)) {
    return denied("destination not in allowed list");
  }
  return null;
}

function evaluateTtlRule(rule: PolicyRule, request: AccessRequest): PolicyResult | null {
  if (
    rule.ttlSeconds != null &&
    request.sessionTtlSeconds != null &&
    request.sessionTtlSeconds > rule.ttlSeconds
  ) {
    return denied(
      `session TTL ${request.sessionTtlSeconds}s exceeds policy max ${rule.ttlSeconds}s`,
    );
  }
  return null;
}

function evaluateSensitivityRule(rule: PolicyRule, request: AccessRequest): boolean {
  return !!(
    rule.requiresApproval &&
    rule.sensitivity &&
    sensitivities.includes(request.sensitivity as Sensitivity) &&
    compareSensitivity(request.sensitivity, rule.sensitivity) >= 0
  );
}

export function evaluatePolicy(policies: PolicyInput[], request: AccessRequest): PolicyResult {
  const enabled = policies.filter((p) => p.enabled);

  if (enabled.length === 0) {
    return {
      allowed: true,
      reason: "no active policies",
      requiresApproval: false,
      effectiveDeliveryModes: [...deliveryModes],
    };
  }

  const rules = enabled.flatMap((p) => p.rules);

  let effectiveModes: string[] = [...deliveryModes];
  let requiresApproval = false;

  for (const rule of rules) {
    let result: PolicyResult | null = null;
    switch (rule.type) {
      case "delivery_mode":
        if (rule.deliveryModes) effectiveModes = intersect(effectiveModes, rule.deliveryModes);
        break;
      case "environment":
        result = evaluateEnvironmentRule(rule, request);
        break;
      case "sensitivity":
        if (evaluateSensitivityRule(rule, request)) requiresApproval = true;
        break;
      case "destination":
        result = evaluateDestinationRule(rule, request);
        break;
      case "ttl":
        result = evaluateTtlRule(rule, request);
        break;
    }
    if (result) return result;
  }

  if (request.credentialAllowedDeliveryModes) {
    effectiveModes = intersect(effectiveModes, request.credentialAllowedDeliveryModes);
  }
  if (request.grantAllowedDeliveryModes) {
    effectiveModes = intersect(effectiveModes, request.grantAllowedDeliveryModes);
  }

  if (!effectiveModes.includes(request.deliveryMode)) {
    return {
      allowed: false,
      reason: "delivery mode not permitted after policy evaluation",
      requiresApproval: false,
      effectiveDeliveryModes: effectiveModes,
    };
  }

  return {
    allowed: true,
    reason: "all policies passed",
    requiresApproval,
    effectiveDeliveryModes: effectiveModes,
  };
}

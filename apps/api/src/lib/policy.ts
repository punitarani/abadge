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
    switch (rule.type) {
      case "delivery_mode": {
        if (rule.deliveryModes) {
          effectiveModes = intersect(effectiveModes, rule.deliveryModes);
        }
        break;
      }

      case "environment": {
        if (
          rule.environments &&
          request.environment != null &&
          !rule.environments.includes(request.environment)
        ) {
          return {
            allowed: false,
            reason: "environment not allowed by policy",
            requiresApproval: false,
            effectiveDeliveryModes: [],
          };
        }
        break;
      }

      case "sensitivity": {
        if (
          rule.requiresApproval &&
          rule.sensitivity &&
          sensitivities.includes(request.sensitivity as Sensitivity) &&
          compareSensitivity(request.sensitivity, rule.sensitivity) >= 0
        ) {
          requiresApproval = true;
        }
        break;
      }

      case "destination": {
        if (request.destination != null) {
          if (rule.blockedDestinations?.includes(request.destination)) {
            return {
              allowed: false,
              reason: "destination is blocked by policy",
              requiresApproval: false,
              effectiveDeliveryModes: [],
            };
          }
          if (rule.destinations && !rule.destinations.includes(request.destination)) {
            return {
              allowed: false,
              reason: "destination not in allowed list",
              requiresApproval: false,
              effectiveDeliveryModes: [],
            };
          }
        }
        break;
      }

      case "ttl": {
        if (
          rule.ttlSeconds != null &&
          request.sessionTtlSeconds != null &&
          request.sessionTtlSeconds > rule.ttlSeconds
        ) {
          return {
            allowed: false,
            reason: `session TTL ${request.sessionTtlSeconds}s exceeds policy max ${rule.ttlSeconds}s`,
            requiresApproval: false,
            effectiveDeliveryModes: [],
          };
        }
        break;
      }
    }
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

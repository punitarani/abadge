import { z } from "zod";
import {
  connectorTypes,
  credentialTypes,
  deliveryModes,
  environments,
  ownerScopes,
  sensitivities,
} from "./constants";

// --- Credentials ---

export const CreateCredentialSchema = z.object({
  name: z.string().min(1).max(128),
  type: z.enum(credentialTypes),
  value: z.string().min(1).max(65536),
  metadata: z.record(z.string()).optional(),
  ownerScope: z.enum(ownerScopes).optional(),
  orgId: z.string().optional(),
  environment: z.enum(environments).optional(),
  service: z.string().max(128).optional(),
  provider: z.string().max(128).optional(),
  project: z.string().max(128).optional(),
  tags: z.array(z.string().max(64)).max(20).optional(),
  sensitivity: z.enum(sensitivities).optional(),
  allowedDeliveryModes: z.array(z.enum(deliveryModes)).min(1).optional(),
  allowedDestinations: z.array(z.string().max(256)).max(50).optional(),
});

export const UpdateCredentialSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  type: z.enum(credentialTypes).optional(),
  value: z.string().min(1).max(65536).optional(),
  metadata: z.record(z.string()).optional(),
  ownerScope: z.enum(ownerScopes).optional(),
  orgId: z.string().nullable().optional(),
  environment: z.enum(environments).nullable().optional(),
  service: z.string().max(128).nullable().optional(),
  provider: z.string().max(128).nullable().optional(),
  project: z.string().max(128).nullable().optional(),
  tags: z.array(z.string().max(64)).max(20).nullable().optional(),
  sensitivity: z.enum(sensitivities).optional(),
  allowedDeliveryModes: z.array(z.enum(deliveryModes)).min(1).nullable().optional(),
  allowedDestinations: z.array(z.string().max(256)).max(50).nullable().optional(),
});

// --- Agents ---

export const CreateAgentSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(256).optional(),
});

// --- Permissions ---

export const GrantPermissionSchema = z.object({
  agentId: z.string().min(1),
  credentialId: z.string().uuid(),
  policyId: z.string().uuid().optional(),
  allowedDeliveryModes: z.array(z.enum(deliveryModes)).min(1).optional(),
  expiresAt: z.coerce.date().optional(),
});

export const RevokePermissionSchema = z.object({
  agentId: z.string().min(1),
  credentialId: z.string().uuid(),
});

// --- Agent access ---

export const AgentAccessRequestSchema = z
  .object({
    credentialName: z.string().min(1).max(128).optional(),
    credentialId: z.string().uuid().optional(),
    purpose: z.string().max(512).optional(),
    deliveryMode: z.enum(deliveryModes).default("env_inject"),
    destination: z.string().max(256).optional(),
    environment: z.enum(environments).optional(),
    sessionId: z.string().uuid().optional(),
  })
  .refine((data) => data.credentialName || data.credentialId, {
    message: "Either credentialName or credentialId is required",
  });

// --- Policies ---

export const policyRuleTypes = [
  "delivery_mode",
  "environment",
  "sensitivity",
  "destination",
  "ttl",
] as const;

export const PolicyRuleSchema = z.object({
  type: z.enum(policyRuleTypes),
  deliveryModes: z.array(z.enum(deliveryModes)).optional(),
  environments: z.array(z.enum(environments)).optional(),
  sensitivity: z.enum(sensitivities).optional(),
  requiresApproval: z.boolean().optional(),
  ttlSeconds: z.number().int().positive().optional(),
  destinations: z.array(z.string().max(256)).optional(),
  blockedDestinations: z.array(z.string().max(256)).optional(),
});

export const CreatePolicySchema = z.object({
  name: z.string().min(1).max(128),
  credentialId: z.string().uuid().optional(),
  rules: z.array(PolicyRuleSchema).min(1),
});

export const UpdatePolicySchema = z.object({
  name: z.string().min(1).max(128).optional(),
  credentialId: z.string().uuid().nullable().optional(),
  rules: z.array(PolicyRuleSchema).min(1).optional(),
  enabled: z.boolean().optional(),
});

// --- Approvals ---

export const CreateApprovalSchema = z.object({
  credentialId: z.string().uuid(),
  agentId: z.string().min(1),
  deliveryMode: z.enum(deliveryModes),
  reason: z.string().max(512).optional(),
  expiresAt: z.coerce.date(),
});

export const ApprovalDecisionSchema = z.object({
  reason: z.string().max(512).optional(),
});

// --- Sessions ---

export const CreateSessionSchema = z.object({
  agentId: z.string().min(1),
  scopes: z.array(z.string().max(128)).optional(),
  allowedDeliveryModes: z.array(z.enum(deliveryModes)).optional(),
  ttlSeconds: z.number().int().positive().max(86400),
});

// --- Connectors ---

export const CreateConnectorSchema = z.object({
  name: z.string().min(1).max(128),
  type: z.enum(connectorTypes),
  config: z.record(z.string()).optional(),
});

export const UpdateConnectorSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  config: z.record(z.string()).optional(),
  enabled: z.boolean().optional(),
});

// --- Inferred types ---

export type CreateCredentialInput = z.infer<typeof CreateCredentialSchema>;
export type UpdateCredentialInput = z.infer<typeof UpdateCredentialSchema>;
export type CreateAgentInput = z.infer<typeof CreateAgentSchema>;
export type GrantPermissionInput = z.infer<typeof GrantPermissionSchema>;
export type RevokePermissionInput = z.infer<typeof RevokePermissionSchema>;
export type AgentAccessRequestInput = z.infer<typeof AgentAccessRequestSchema>;
export type CreatePolicyInput = z.infer<typeof CreatePolicySchema>;
export type UpdatePolicyInput = z.infer<typeof UpdatePolicySchema>;
export type PolicyRuleInput = z.infer<typeof PolicyRuleSchema>;
export type CreateApprovalInput = z.infer<typeof CreateApprovalSchema>;
export type ApprovalDecisionInput = z.infer<typeof ApprovalDecisionSchema>;
export type CreateSessionInput = z.infer<typeof CreateSessionSchema>;
export type CreateConnectorInput = z.infer<typeof CreateConnectorSchema>;
export type UpdateConnectorInput = z.infer<typeof UpdateConnectorSchema>;

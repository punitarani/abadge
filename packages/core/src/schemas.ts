import { z } from "zod";
import { credentialTypes } from "./constants";

export const CreateCredentialSchema = z.object({
  name: z.string().min(1).max(128),
  type: z.enum(credentialTypes),
  value: z.string().min(1).max(65536),
  metadata: z.record(z.string()).optional(),
});

export const UpdateCredentialSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  type: z.enum(credentialTypes).optional(),
  value: z.string().min(1).max(65536).optional(),
  metadata: z.record(z.string()).optional(),
});

export const CreateAgentSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(256).optional(),
});

export const GrantPermissionSchema = z.object({
  agentId: z.string().min(1),
  credentialId: z.string().uuid(),
});

export const RevokePermissionSchema = z.object({
  agentId: z.string().min(1),
  credentialId: z.string().uuid(),
});

export const AgentAccessRequestSchema = z
  .object({
    credentialName: z.string().min(1).max(128).optional(),
    credentialId: z.string().uuid().optional(),
    purpose: z.string().max(512).optional(),
  })
  .refine((data) => data.credentialName || data.credentialId, {
    message: "Either credentialName or credentialId is required",
  });

export const PolicyRuleSchema = z.object({
  type: z.enum(["rate_limit", "time_window", "ip_allowlist", "expiry"]),
  limit: z.number().int().positive().optional(),
  window: z.string().max(64).optional(),
  allowlist: z.array(z.string().max(256)).optional(),
  expiresAt: z.string().datetime().optional(),
});

export const CreatePolicySchema = z.object({
  name: z.string().min(1).max(128),
  credentialId: z.string().uuid().optional(),
  rules: z.array(PolicyRuleSchema).min(1),
});

export const UpdatePolicySchema = z.object({
  name: z.string().min(1).max(128).optional(),
  rules: z.array(PolicyRuleSchema).min(1).optional(),
  enabled: z.boolean().optional(),
});

export type CreateCredentialInput = z.infer<typeof CreateCredentialSchema>;
export type UpdateCredentialInput = z.infer<typeof UpdateCredentialSchema>;
export type CreateAgentInput = z.infer<typeof CreateAgentSchema>;
export type GrantPermissionInput = z.infer<typeof GrantPermissionSchema>;
export type RevokePermissionInput = z.infer<typeof RevokePermissionSchema>;
export type AgentAccessRequestInput = z.infer<typeof AgentAccessRequestSchema>;
export type PolicyRuleInput = z.infer<typeof PolicyRuleSchema>;
export type CreatePolicyInput = z.infer<typeof CreatePolicySchema>;
export type UpdatePolicyInput = z.infer<typeof UpdatePolicySchema>;

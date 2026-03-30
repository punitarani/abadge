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

export type CreateCredentialInput = z.infer<typeof CreateCredentialSchema>;
export type UpdateCredentialInput = z.infer<typeof UpdateCredentialSchema>;
export type CreateAgentInput = z.infer<typeof CreateAgentSchema>;
export type GrantPermissionInput = z.infer<typeof GrantPermissionSchema>;
export type RevokePermissionInput = z.infer<typeof RevokePermissionSchema>;
export type AgentAccessRequestInput = z.infer<typeof AgentAccessRequestSchema>;

export const ApprovalDecisionSchema = z.object({
  reason: z.string().max(512).optional(),
});

export type ApprovalDecisionInput = z.infer<typeof ApprovalDecisionSchema>;

import type { AccessAction, CredentialType } from "./constants";

export interface Credential {
  id: string;
  userId: string;
  name: string;
  type: CredentialType;
  metadata: Record<string, string> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Agent {
  id: string;
  name: string | null;
  prefix: string | null;
  start: string | null;
  enabled: boolean | null;
  lastRequest: Date | null;
  metadata: string | null;
  createdAt: Date;
}

export interface Permission {
  agentId: string;
  credentialId: string;
  grantedAt: Date;
  grantedBy: string;
}

export interface AccessLogEntry {
  id: number;
  agentId: string;
  credentialId: string;
  credentialName: string;
  agentName: string;
  action: AccessAction;
  purpose: string | null;
  ipAddress: string | null;
  timestamp: Date;
}

export interface CredentialAccessResponse {
  credential: {
    name: string;
    type: CredentialType;
    value: string;
    metadata: Record<string, string> | null;
  };
}

export interface AgentRegistrationResponse {
  agent: {
    id: string;
    name: string | null;
    prefix: string | null;
  };
  apiKey: string;
}

export interface ApiErrorResponse {
  error: string;
  code?: string;
}

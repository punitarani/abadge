import type {
  AccessAction,
  AccessOutcome,
  ApprovalStatus,
  ConnectorType,
  CredentialType,
  DeliveryMode,
  Environment,
  OwnerScope,
  PrincipalType,
  Sensitivity,
  SourceType,
} from "./constants";

export interface ExternalRef {
  name?: string;
  path?: string;
  version?: string;
}

export interface Credential {
  id: string;
  userId: string;
  name: string;
  type: CredentialType;
  metadata: Record<string, string> | null;
  ownerScope: OwnerScope;
  environment: Environment | null;
  service: string | null;
  provider: string | null;
  project: string | null;
  tags: string[] | null;
  sensitivity: Sensitivity;
  allowedDeliveryModes: DeliveryMode[] | null;
  allowedDestinations: string[] | null;
  sourceType: SourceType;
  connectorId: string | null;
  externalRef: ExternalRef | null;
  createdBy: string;
  updatedBy: string;
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
  policyId: string | null;
  allowedDeliveryModes: DeliveryMode[] | null;
  expiresAt: Date | null;
  grantedAt: Date;
  grantedBy: string;
}

export interface AccessLogEntry {
  id: number;
  agentId: string;
  credentialId: string;
  credentialName: string;
  agentName: string;
  /** @deprecated use outcome */
  action: AccessAction;
  outcome: AccessOutcome;
  principalType: PrincipalType;
  requestedAction: string | null;
  deliveryMode: DeliveryMode | null;
  destination: string | null;
  approvalId: string | null;
  sessionId: string | null;
  environment: Environment | null;
  connectorUsed: string | null;
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
  deliveryMode: DeliveryMode;
  sessionId: string | null;
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

export interface PolicyRule {
  type: "delivery_mode" | "environment" | "sensitivity" | "destination" | "ttl";
  deliveryModes?: DeliveryMode[];
  environments?: Environment[];
  sensitivity?: Sensitivity;
  requiresApproval?: boolean;
  ttlSeconds?: number;
  destinations?: string[];
  blockedDestinations?: string[];
}

export interface Policy {
  id: string;
  name: string;
  credentialId: string | null;
  userId: string;
  rules: PolicyRule[];
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PolicyEvaluationResult {
  allowed: boolean;
  reason: string;
  requiresApproval: boolean;
  allowedDeliveryModes: DeliveryMode[];
}

export interface Approval {
  id: string;
  requesterId: string;
  approverId: string | null;
  credentialId: string;
  agentId: string;
  status: ApprovalStatus;
  deliveryMode: DeliveryMode;
  reason: string | null;
  decidedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

export interface BrokerSession {
  id: string;
  agentId: string;
  userId: string;
  scopes: string[];
  allowedDeliveryModes: DeliveryMode[];
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface Connector {
  id: string;
  userId: string;
  name: string;
  type: ConnectorType;
  enabled: boolean;
  lastSync: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AutoGrant {
  id: string;
  agentId: string;
  userId: string;
  matchEnvironment: Environment | null;
  matchTags: string[] | null;
  matchType: CredentialType | null;
  matchService: string | null;
  matchSensitivity: Sensitivity | null;
  policyId: string | null;
  allowedDeliveryModes: DeliveryMode[] | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AccessRequest {
  credentialId?: string;
  credentialName?: string;
  deliveryMode: DeliveryMode;
  destination?: string;
  purpose?: string;
  environment?: Environment;
  sessionId?: string;
}

export interface AgentGroup {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentGroupMember {
  groupId: string;
  agentId: string;
  addedAt: Date;
}

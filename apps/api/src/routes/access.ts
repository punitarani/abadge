import type { DeliveryMode, Environment } from "@abadge/core";
import { AgentAccessRequestSchema } from "@abadge/core";
import type { Database } from "@abadge/db";
import { and, eq, gt } from "@abadge/db";
import {
  accessLog,
  agentCredentialPermissions,
  approvals,
  autoGrants,
  connectors,
  credentials,
  policies,
} from "@abadge/db/schema";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { matchesAutoGrant } from "../lib/auto-grant";
import type { ExternalRef } from "../lib/connectors";
import { createHttpConnector } from "../lib/connectors";
import { decrypt } from "../lib/crypto";
import {
  evaluatePolicy,
  type AccessRequest as PolicyAccessRequest,
  type PolicyInput,
  type PolicyRule,
} from "../lib/policy";
import { agentAuthMiddleware } from "../middleware/agent-auth";
import type { AgentEnv } from "../types";

function isDeliveryModeAllowed(
  requested: DeliveryMode,
  credentialAllowed: DeliveryMode[] | null,
  permissionAllowed: string[] | null,
): boolean {
  if (credentialAllowed && credentialAllowed.length > 0) {
    if (!credentialAllowed.includes(requested)) return false;
  }
  if (permissionAllowed && permissionAllowed.length > 0) {
    if (!permissionAllowed.includes(requested)) return false;
  }
  return true;
}

interface AuditBase {
  agentId: string;
  agentName: string;
  purpose: string | undefined;
  ipAddress: string | undefined;
  principalType: "agent";
  requestedAction: string;
  deliveryMode: DeliveryMode;
  destination: string | undefined;
  environment: Environment | undefined;
  sessionId: string | null;
}

async function logDenied(
  db: Database,
  auditBase: AuditBase,
  credentialId: string,
  credentialName: string,
  outcome: "denied" | "pending_approval" = "denied",
  approvalId?: string,
): Promise<void> {
  await db.insert(accessLog).values({
    ...auditBase,
    credentialId,
    credentialName,
    action: "denied",
    outcome,
    ...(approvalId ? { approvalId } : {}),
  });
}

async function findAutoGrantPermission(
  db: Database,
  agentId: string,
  agentUserId: string,
  credential: {
    id: string;
    environment: string | null;
    tags: unknown;
    type: string;
    service: string | null;
    sensitivity: string | null;
  },
): Promise<{
  agentId: string;
  credentialId: string;
  policyId: string | null;
  allowedDeliveryModes: string[] | null;
  expiresAt: Date | null;
  grantedAt: Date;
  grantedBy: string;
} | null> {
  const grants = await db
    .select()
    .from(autoGrants)
    .where(and(eq(autoGrants.agentId, agentId), eq(autoGrants.userId, agentUserId)));

  const now = new Date();
  const matchingGrant = grants.find(
    (g) =>
      (!g.expiresAt || g.expiresAt > now) &&
      matchesAutoGrant(
        {
          environment: credential.environment,
          tags: credential.tags as string[] | null,
          type: credential.type,
          service: credential.service,
          sensitivity: credential.sensitivity,
        },
        {
          matchEnvironment: g.matchEnvironment,
          matchTags: g.matchTags,
          matchType: g.matchType,
          matchService: g.matchService,
          matchSensitivity: g.matchSensitivity,
        },
      ),
  );

  if (!matchingGrant) return null;

  return {
    agentId,
    credentialId: credential.id,
    policyId: matchingGrant.policyId,
    allowedDeliveryModes: matchingGrant.allowedDeliveryModes,
    expiresAt: matchingGrant.expiresAt,
    grantedAt: matchingGrant.createdAt,
    grantedBy: agentUserId,
  };
}

async function fetchExternalSecret(
  db: Database,
  credential: { connectorId: string | null; externalRef: unknown },
  encryptionKey: string,
): Promise<{ value: string } | { error: string; code: string; status: number }> {
  if (!credential.connectorId) {
    return { error: "External credential has no connector", code: "CONNECTOR_ERROR", status: 500 };
  }

  const connector = await db.query.connectors.findFirst({
    where: eq(connectors.id, credential.connectorId),
  });

  if (!connector?.encryptedConfig || !connector.configIv) {
    return {
      error: "Connector not found or not configured",
      code: "CONNECTOR_NOT_FOUND",
      status: 500,
    };
  }

  const httpConnector = createHttpConnector(connector.type);
  if (!httpConnector) {
    return {
      error: "Connector type does not support server-side fetch",
      code: "CONNECTOR_ERROR",
      status: 500,
    };
  }

  const configJson = await decrypt(connector.encryptedConfig, connector.configIv, encryptionKey);
  const config = JSON.parse(configJson) as Record<string, unknown>;
  const ref = (credential.externalRef as ExternalRef) ?? {};

  try {
    const fetched = await httpConnector.fetchSecret(ref, config);
    return { value: fetched.value };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Connector fetch failed";
    return { error: msg, code: "CONNECTOR_ERROR", status: 502 };
  }
}

async function resolvePermission(
  db: Database,
  agentId: string,
  agentUserId: string,
  credential: {
    id: string;
    environment: string | null;
    tags: unknown;
    type: string;
    service: string | null;
    sensitivity: string | null;
  },
): ReturnType<typeof findAutoGrantPermission> {
  const explicit = await db.query.agentCredentialPermissions.findFirst({
    where: and(
      eq(agentCredentialPermissions.agentId, agentId),
      eq(agentCredentialPermissions.credentialId, credential.id),
    ),
  });
  if (explicit) return explicit;
  return findAutoGrantPermission(db, agentId, agentUserId, credential);
}

async function resolveSecretValue(
  db: Database,
  credential: {
    sourceType: string | null;
    connectorId: string | null;
    externalRef: unknown;
    encryptedValue: string;
    iv: string;
  },
  encryptionKey: string,
): Promise<{ value: string } | { error: string; code: string; status: number }> {
  if (credential.sourceType === "external") {
    return fetchExternalSecret(db, credential, encryptionKey);
  }
  const value = await decrypt(credential.encryptedValue, credential.iv, encryptionKey);
  return { value };
}

async function findCredentialByIdOrName(
  db: Database,
  body: { credentialId?: string; credentialName?: string },
  userId: string,
): Promise<typeof credentials.$inferSelect | undefined> {
  if (body.credentialId) {
    return db.query.credentials.findFirst({
      where: and(eq(credentials.id, body.credentialId), eq(credentials.userId, userId)),
    });
  }
  if (body.credentialName) {
    return db.query.credentials.findFirst({
      where: and(eq(credentials.name, body.credentialName), eq(credentials.userId, userId)),
    });
  }
  return undefined;
}

export const accessRoutes = new Hono<AgentEnv>()
  .use("*", agentAuthMiddleware)
  .post("/credentials/access", zValidator("json", AgentAccessRequestSchema), async (c) => {
    const agent = c.get("agent");
    const db = c.get("db");
    const body = c.req.valid("json");

    const agentId = agent.id as string;
    const agentUserId = agent.referenceId as string;
    const deliveryMode = body.deliveryMode ?? "env_inject";

    const auditBase: AuditBase = {
      agentId,
      agentName: (agent.name as string) ?? "unknown",
      purpose: body.purpose,
      ipAddress: c.req.header("cf-connecting-ip"),
      principalType: "agent",
      requestedAction: "read",
      deliveryMode,
      destination: body.destination,
      environment: body.environment,
      sessionId: c.get("sessionId") ?? null,
    };

    const credential = await findCredentialByIdOrName(db, body, agentUserId);
    if (!credential) {
      return c.json({ error: "Credential not found" }, 404);
    }

    const permission = await resolvePermission(db, agentId, agentUserId, credential);
    if (!permission) {
      await logDenied(db, auditBase, credential.id, credential.name);
      return c.json({ error: "Access denied" }, 403);
    }

    if (permission.expiresAt && permission.expiresAt < new Date()) {
      await logDenied(db, auditBase, credential.id, credential.name);
      return c.json({ error: "Permission expired" }, 403);
    }

    const policyResult = await evaluateAttachedPolicy(
      db,
      permission,
      credential,
      deliveryMode,
      body,
      auditBase,
      agentId,
      agentUserId,
    );
    if (policyResult) return c.json(policyResult.body, policyResult.status);

    const needsDirectCheck =
      !permission.policyId || !(await hasActivePolicy(db, permission.policyId));
    if (
      needsDirectCheck &&
      !isDeliveryModeAllowed(
        deliveryMode,
        credential.allowedDeliveryModes as DeliveryMode[] | null,
        permission.allowedDeliveryModes as DeliveryMode[] | null,
      )
    ) {
      await logDenied(db, auditBase, credential.id, credential.name);
      return c.json({ error: "Delivery mode not allowed", code: "DELIVERY_MODE_NOT_ALLOWED" }, 403);
    }

    await db.insert(accessLog).values({
      ...auditBase,
      credentialId: credential.id,
      credentialName: credential.name,
      action: "read",
      outcome: "allowed",
    });

    const credentialMeta = {
      name: credential.name,
      type: credential.type,
      metadata: credential.metadata,
    };
    const valueNeeded =
      deliveryMode === "reveal" || deliveryMode === "env_inject" || deliveryMode === "file_mount";

    if (!valueNeeded) {
      return c.json({ credential: credentialMeta, deliveryMode, approved: true });
    }

    const result = await resolveSecretValue(db, credential, c.env.ENCRYPTION_KEY);
    if ("error" in result) {
      return c.json({ error: result.error, code: result.code }, result.status as 500);
    }

    return c.json({
      credential: credentialMeta,
      deliveryMode,
      value: result.value,
      approved: true,
    });
  });

async function hasActivePolicy(db: Database, policyId: string): Promise<boolean> {
  const policy = await db.query.policies.findFirst({
    where: and(eq(policies.id, policyId), eq(policies.enabled, true)),
  });
  return !!policy;
}

interface PolicyDenial {
  body: Record<string, unknown>;
  status: 202 | 403;
}

async function evaluateAttachedPolicy(
  db: Database,
  permission: { policyId: string | null; allowedDeliveryModes: string[] | null },
  credential: {
    id: string;
    name: string;
    environment: string | null;
    sensitivity: string | null;
    allowedDeliveryModes: unknown;
  },
  deliveryMode: string,
  body: { destination?: string },
  auditBase: AuditBase,
  agentId: string,
  agentUserId: string,
): Promise<PolicyDenial | null> {
  if (!permission.policyId) return null;

  const policy = await db.query.policies.findFirst({
    where: and(eq(policies.id, permission.policyId), eq(policies.enabled, true)),
  });
  if (!policy) return null;

  const policyInput: PolicyInput = {
    rules: (policy.rules as unknown as PolicyRule[]) ?? [],
    enabled: policy.enabled ?? true,
  };

  const policyRequest: PolicyAccessRequest = {
    deliveryMode,
    environment: credential.environment,
    destination: body.destination ?? null,
    sensitivity: (credential.sensitivity as string) ?? "medium",
    credentialAllowedDeliveryModes: credential.allowedDeliveryModes as string[] | null,
    grantAllowedDeliveryModes: permission.allowedDeliveryModes as string[] | null,
  };

  const result = evaluatePolicy([policyInput], policyRequest);

  if (!result.allowed) {
    await logDenied(db, auditBase, credential.id, credential.name);
    return { body: { error: result.reason, code: "POLICY_VIOLATION" }, status: 403 };
  }

  if (result.requiresApproval) {
    const approvalResult = await handleApprovalFlow(
      db,
      agentId,
      credential.id,
      credential.name,
      deliveryMode,
      agentUserId,
      auditBase,
    );
    if (approvalResult) return approvalResult;
  }

  if (!result.effectiveDeliveryModes.includes(deliveryMode)) {
    await logDenied(db, auditBase, credential.id, credential.name);
    return {
      body: { error: "Delivery mode not allowed", code: "DELIVERY_MODE_NOT_ALLOWED" },
      status: 403,
    };
  }

  return null;
}

async function handleApprovalFlow(
  db: Database,
  agentId: string,
  credentialId: string,
  credentialName: string,
  deliveryMode: string,
  agentUserId: string,
  auditBase: AuditBase,
): Promise<PolicyDenial | null> {
  const existingApproval = await db.query.approvals.findFirst({
    where: and(
      eq(approvals.agentId, agentId),
      eq(approvals.credentialId, credentialId),
      eq(approvals.deliveryMode, deliveryMode),
      eq(approvals.status, "approved"),
      gt(approvals.expiresAt, new Date()),
    ),
  });

  if (existingApproval) return null;

  const rows = await db
    .insert(approvals)
    .values({
      id: crypto.randomUUID(),
      agentId,
      credentialId,
      requesterId: agentUserId,
      deliveryMode,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    .returning();

  const approval = rows[0];
  await logDenied(db, auditBase, credentialId, credentialName, "pending_approval", approval?.id);

  return {
    body: { error: "Approval required", code: "PENDING_APPROVAL", approvalId: approval?.id },
    status: 202,
  };
}

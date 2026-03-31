import type { DeliveryMode } from "@abadge/core";
import { AgentAccessRequestSchema } from "@abadge/core";
import { and, eq, gt } from "@abadge/db";
import {
  accessLog,
  agentCredentialPermissions,
  approvals,
  credentials,
  policies,
} from "@abadge/db/schema";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
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

export const accessRoutes = new Hono<AgentEnv>()
  .use("*", agentAuthMiddleware)
  .post("/credentials/access", zValidator("json", AgentAccessRequestSchema), async (c) => {
    const agent = c.get("agent");
    const db = c.get("db");
    const body = c.req.valid("json");

    const agentId = agent.id as string;
    const agentUserId = agent.referenceId as string;
    const agentName = (agent.name as string) ?? "unknown";
    const deliveryMode = body.deliveryMode ?? "env_inject";
    const ipAddress = c.req.header("cf-connecting-ip");

    const auditBase = {
      agentId,
      agentName,
      purpose: body.purpose,
      ipAddress,
      principalType: "agent" as const,
      requestedAction: "read",
      deliveryMode,
      destination: body.destination,
      environment: body.environment,
      sessionId: c.get("sessionId") ?? null,
    };

    // Find the credential — always scoped to the agent's owner
    const credentialName = body.credentialName;
    const credential = body.credentialId
      ? await db.query.credentials.findFirst({
          where: and(eq(credentials.id, body.credentialId), eq(credentials.userId, agentUserId)),
        })
      : credentialName
        ? await db.query.credentials.findFirst({
            where: and(eq(credentials.name, credentialName), eq(credentials.userId, agentUserId)),
          })
        : undefined;

    if (!credential) {
      return c.json({ error: "Credential not found" }, 404);
    }

    // Check permission
    const permission = await db.query.agentCredentialPermissions.findFirst({
      where: and(
        eq(agentCredentialPermissions.agentId, agentId),
        eq(agentCredentialPermissions.credentialId, credential.id),
      ),
    });

    if (!permission) {
      await db.insert(accessLog).values({
        ...auditBase,
        credentialId: credential.id,
        credentialName: credential.name,
        action: "denied",
        outcome: "denied",
      });
      return c.json({ error: "Access denied" }, 403);
    }

    // Check permission expiration
    if (permission.expiresAt && permission.expiresAt < new Date()) {
      await db.insert(accessLog).values({
        ...auditBase,
        credentialId: credential.id,
        credentialName: credential.name,
        action: "denied",
        outcome: "denied",
      });
      return c.json({ error: "Permission expired" }, 403);
    }

    // Evaluate attached policy if present
    let policyEvaluated = false;

    if (permission.policyId) {
      const policy = await db.query.policies.findFirst({
        where: and(eq(policies.id, permission.policyId), eq(policies.enabled, true)),
      });

      if (policy) {
        policyEvaluated = true;

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
          await db.insert(accessLog).values({
            ...auditBase,
            credentialId: credential.id,
            credentialName: credential.name,
            action: "denied",
            outcome: "denied",
          });
          return c.json({ error: result.reason, code: "POLICY_VIOLATION" }, 403);
        }

        if (result.requiresApproval) {
          // Check for an existing approved approval before creating a new one
          const existingApproval = await db.query.approvals.findFirst({
            where: and(
              eq(approvals.agentId, agentId),
              eq(approvals.credentialId, credential.id),
              eq(approvals.deliveryMode, deliveryMode),
              eq(approvals.status, "approved"),
              gt(approvals.expiresAt, new Date()),
            ),
          });

          if (!existingApproval) {
            const rows = await db
              .insert(approvals)
              .values({
                id: crypto.randomUUID(),
                agentId,
                credentialId: credential.id,
                requesterId: agentUserId,
                deliveryMode,
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
              })
              .returning();

            const approval = rows[0];
            await db.insert(accessLog).values({
              ...auditBase,
              credentialId: credential.id,
              credentialName: credential.name,
              action: "denied",
              outcome: "pending_approval",
              approvalId: approval?.id,
            });

            return c.json(
              {
                error: "Approval required",
                code: "PENDING_APPROVAL",
                approvalId: approval?.id,
              },
              202,
            );
          }
          // Existing approved approval found — fall through to grant access
        }

        // Policy passed but delivery mode may be restricted by effective modes
        if (!result.effectiveDeliveryModes.includes(deliveryMode)) {
          await db.insert(accessLog).values({
            ...auditBase,
            credentialId: credential.id,
            credentialName: credential.name,
            action: "denied",
            outcome: "denied",
          });
          return c.json(
            { error: "Delivery mode not allowed", code: "DELIVERY_MODE_NOT_ALLOWED" },
            403,
          );
        }
      }
    }

    // When no policy was evaluated, check delivery mode allow-lists directly
    if (!policyEvaluated) {
      if (
        !isDeliveryModeAllowed(
          deliveryMode,
          credential.allowedDeliveryModes as DeliveryMode[] | null,
          permission.allowedDeliveryModes as DeliveryMode[] | null,
        )
      ) {
        await db.insert(accessLog).values({
          ...auditBase,
          credentialId: credential.id,
          credentialName: credential.name,
          action: "denied",
          outcome: "denied",
        });
        return c.json(
          { error: "Delivery mode not allowed", code: "DELIVERY_MODE_NOT_ALLOWED" },
          403,
        );
      }
    }

    // Log successful access
    await db.insert(accessLog).values({
      ...auditBase,
      credentialId: credential.id,
      credentialName: credential.name,
      action: "read",
      outcome: "allowed",
    });

    // Modes that require the decrypted value: reveal (direct), env_inject and
    // file_mount (broker needs the value to inject into subprocess/file).
    // browser_fill and operation_only never return the secret.
    const valueNeeded =
      deliveryMode === "reveal" || deliveryMode === "env_inject" || deliveryMode === "file_mount";

    if (valueNeeded) {
      const decryptedValue = await decrypt(
        credential.encryptedValue,
        credential.iv,
        c.env.ENCRYPTION_KEY,
      );

      return c.json({
        credential: {
          name: credential.name,
          type: credential.type,
          metadata: credential.metadata,
        },
        deliveryMode,
        value: decryptedValue,
        approved: true,
      });
    }

    // For browser_fill and operation_only, return metadata only
    return c.json({
      credential: {
        name: credential.name,
        type: credential.type,
        metadata: credential.metadata,
      },
      deliveryMode,
      approved: true,
    });
  });

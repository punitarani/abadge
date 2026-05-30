import { type CloudflareEmailBinding, createAuth } from "@abadge/auth";
import type { Database, Transaction } from "@abadge/db";
import { createDb } from "@abadge/db";
import { validateWorkerEnv, type WorkerEnv } from "@abadge/env/worker";
export interface HyperdriveBindingLike {
  connectionString: string;
}

export interface AppBindings extends WorkerEnv {
  DATABASE_URL?: string;
  HYPERDRIVE?: HyperdriveBindingLike;
  SEND_EMAIL: CloudflareEmailBinding;
}

export interface BaseRequestContext {
  req: Request;
  resHeaders: Headers;
  env: AppBindings;
  validatedEnv: WorkerEnv;
  // The org-scoped procedures (scopedSessionProcedure / agentProcedure) replace
  // this with a transaction that has `app.current_org` set (the GUC the
  // FORCE-RLS policies read), so every tenant-table query the request issues runs
  // under that org context. Pre-org procedures (publicProcedure / userProcedure)
  // and pre-auth identity resolution see the pooled Database. Both are structurally
  // PgDatabase, so downstream query code is identical for either.
  db: Database | Transaction;
  auth: ReturnType<typeof createAuth>;
  ipAddress?: string;
}

// `user_api_key` is a personal `abu_` token resolved on the bearer/session path.
// It authenticates the management surface only; it never yields an AgentIdentity,
// so it cannot reach the agent-gated `access.*` surface.
export type SessionAuthMethod = "browser_session" | "bearer_session" | "user_api_key";

export interface SessionIdentity {
  kind: "session";
  userId: string;
  organizationId: string;
  authMethod: SessionAuthMethod;
}

export interface OptionalOrgSessionIdentity {
  kind: "session";
  userId: string;
  organizationId: string | null;
  authMethod: SessionAuthMethod;
}

export interface OptionalOrgSessionRequestContext extends BaseRequestContext {
  identity: OptionalOrgSessionIdentity;
}

export interface AgentIdentity {
  kind: "agent";
  agentId: string;
  // Null when the agent is orphaned (its creating user was deleted).
  agentUserId: string | null;
  agentOrganizationId: string;
  agentLocality: "local" | "remote";
}

export interface SessionRequestContext extends BaseRequestContext {
  identity: SessionIdentity;
}

export interface AgentRequestContext extends BaseRequestContext {
  identity: AgentIdentity;
}

export function getConnectionString(env: AppBindings): string {
  if (env.HYPERDRIVE) {
    return env.HYPERDRIVE.connectionString;
  }
  if (env.DATABASE_URL) {
    return env.DATABASE_URL;
  }
  throw new Error("No database connection: set HYPERDRIVE binding or DATABASE_URL");
}

export function createRequestContext(options: {
  req: Request;
  resHeaders: Headers;
  env: AppBindings;
}): BaseRequestContext {
  const validatedEnv = validateWorkerEnv(options.env as unknown as Record<string, unknown>);
  const db = createDb(getConnectionString(options.env));
  const env = { ...options.env, ...validatedEnv };

  return {
    req: options.req,
    resHeaders: options.resHeaders,
    env,
    validatedEnv,
    db,
    auth: createAuth(db, { ...validatedEnv, SEND_EMAIL: options.env.SEND_EMAIL }),
    ipAddress:
      options.req.headers.get("cf-connecting-ip") ??
      options.req.headers.get("x-forwarded-for") ??
      options.req.headers.get("x-real-ip") ??
      undefined,
  };
}

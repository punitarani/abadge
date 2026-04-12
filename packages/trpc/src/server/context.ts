import { createAuth } from "@abadge/auth";
import type { Database } from "@abadge/db";
import { createDb } from "@abadge/db";
import { validateWorkerEnv, type WorkerEnv } from "@abadge/env/worker";
export interface HyperdriveBindingLike {
  connectionString: string;
}

export interface AppBindings extends WorkerEnv {
  DATABASE_URL?: string;
  HYPERDRIVE?: HyperdriveBindingLike;
}

export interface BaseRequestContext {
  req: Request;
  resHeaders: Headers;
  env: AppBindings;
  validatedEnv: WorkerEnv;
  db: Database;
  auth: ReturnType<typeof createAuth>;
  ipAddress?: string;
}

export interface SessionIdentity {
  kind: "session";
  userId: string;
  organizationId: string;
  authMethod: "browser_session" | "bearer_session";
}

export interface AgentIdentity {
  kind: "agent";
  agentId: string;
  agentUserId: string;
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
    auth: createAuth(db, validatedEnv),
    ipAddress:
      options.req.headers.get("cf-connecting-ip") ??
      options.req.headers.get("x-forwarded-for") ??
      options.req.headers.get("x-real-ip") ??
      undefined,
  };
}

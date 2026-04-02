import { createAuth, getTrustedOrigins } from "@abadge/auth";
import { validateWorkerEnv } from "@abadge/env/worker";
import { createServerCaller, handleTrpcRequest } from "@abadge/trpc/server";
import { TRPCError } from "@trpc/server";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { getConnectionString, getDb } from "./lib/db";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import type { Bindings } from "./types";

const app = new Hono<{ Bindings: Bindings }>();
type ApiContext = Context<{ Bindings: Bindings }>;

type ApiErrorBody = {
  error: string;
  code?: string;
  issues?: unknown;
};

function toApiError(error: unknown): { status: number; body: ApiErrorBody } {
  if (error instanceof TRPCError) {
    const statusSource = error.cause as unknown as { statusCode?: unknown } | undefined;
    const status = typeof statusSource?.statusCode === "number" ? statusSource.statusCode : 500;
    const cause = error.cause as unknown as { code?: unknown; issues?: unknown } | undefined;

    return {
      status,
      body: {
        error: error.message || "Request failed",
        ...(typeof cause?.code === "string" ? { code: cause.code } : {}),
        ...(cause?.issues ? { issues: cause.issues } : {}),
      },
    };
  }

  if (error instanceof Error) {
    return {
      status: 500,
      body: { error: error.message || "Internal server error" },
    };
  }

  return {
    status: 500,
    body: { error: "Internal server error" },
  };
}

async function withCallerResult(
  c: ApiContext,
  handler: (caller: ReturnType<typeof createServerCaller>) => Promise<Response>,
): Promise<Response> {
  try {
    const caller = createServerCaller(c.req.raw, c.env);
    return await handler(caller);
  } catch (error) {
    const { status, body } = toApiError(error);
    return c.json(body, status as 400 | 401 | 403 | 404 | 409 | 429 | 500);
  }
}

function readJsonBody<T>(request: Request): Promise<T> {
  return request.json() as Promise<T>;
}

function readOptionalInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// Global middleware
app.use("*", secureHeaders());
app.use("*", async (c, next) =>
  cors({
    origin: getTrustedOrigins(c.env),
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })(c, next),
);

// Rate limiting
app.use("/api/auth/*", rateLimitMiddleware(60, 60_000));
app.use("/trpc/*", rateLimitMiddleware(100, 60_000));
app.use("/v1/*", rateLimitMiddleware(100, 60_000));

// Better Auth catch-all route
app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const db = getDb(getConnectionString(c.env));
  const auth = createAuth(db, validateWorkerEnv(c.env as unknown as Record<string, unknown>));
  return auth.handler(c.req.raw);
});

app.get("/v1/agents", (c) =>
  withCallerResult(c, async (caller) => c.json(await caller.agents.list())),
);

app.post("/v1/agents", (c) =>
  withCallerResult(c, async (caller) => {
    const body = await readJsonBody<Record<string, unknown>>(c.req.raw);
    return c.json(await caller.agents.create(body), 201);
  }),
);

app.get("/v1/agents/:id", (c) =>
  withCallerResult(c, async (caller) =>
    c.json(await caller.agents.get({ agentId: c.req.param("id") })),
  ),
);

app.post("/v1/agents/:id/rotate", (c) =>
  withCallerResult(c, async (caller) =>
    c.json(await caller.agents.rotate({ agentId: c.req.param("id") })),
  ),
);

app.delete("/v1/agents/:id", (c) =>
  withCallerResult(c, async (caller) =>
    c.json(await caller.agents.revoke({ agentId: c.req.param("id") })),
  ),
);

app.get("/v1/permissions", (c) =>
  withCallerResult(c, async (caller) =>
    c.json(
      await caller.permissions.list({
        ...(c.req.query("agentId") ? { agentId: c.req.query("agentId") } : {}),
        ...(c.req.query("itemId") ? { itemId: c.req.query("itemId") } : {}),
      }),
    ),
  ),
);

app.post("/v1/permissions", (c) =>
  withCallerResult(c, async (caller) => {
    const body = await readJsonBody<Record<string, unknown>>(c.req.raw);
    return c.json(await caller.permissions.create(body), 201);
  }),
);

app.delete("/v1/permissions/:id", (c) =>
  withCallerResult(c, async (caller) =>
    c.json(await caller.permissions.revoke({ permissionId: c.req.param("id") })),
  ),
);

app.get("/v1/audit", (c) =>
  withCallerResult(c, async (caller) => {
    const limit = readOptionalInt(c.req.query("limit"));

    return c.json(
      await caller.audit.list({
        ...(c.req.query("eventType") ? { eventType: c.req.query("eventType") } : {}),
        ...(c.req.query("result") ? { result: c.req.query("result") } : {}),
        ...(c.req.query("agentId") ? { agentId: c.req.query("agentId") } : {}),
        ...(c.req.query("itemId") ? { itemId: c.req.query("itemId") } : {}),
        ...(c.req.query("cursor") ? { cursor: c.req.query("cursor") } : {}),
        ...(limit !== undefined ? { limit } : {}),
      }),
    );
  }),
);

app.all("/trpc/*", (c) => handleTrpcRequest(c.req.raw, c.env));

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

export default app;

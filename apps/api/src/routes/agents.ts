import { Hono } from "hono";
import { readJsonBody, withCallerResult } from "../lib/rest-helpers.js";
import type { Bindings } from "../types.js";

const agents = new Hono<{ Bindings: Bindings }>();

agents.get("/", (c) => withCallerResult(c, async (caller) => c.json(await caller.agents.list())));

agents.post("/", (c) =>
  withCallerResult(c, async (caller) => {
    const body = await readJsonBody<Record<string, unknown>>(c.req.raw);
    return c.json(await caller.agents.create(body), 201);
  }),
);

agents.get("/:id", (c) =>
  withCallerResult(c, async (caller) =>
    c.json(await caller.agents.get({ agentId: c.req.param("id") })),
  ),
);

agents.post("/:id/rotate", (c) =>
  withCallerResult(c, async (caller) =>
    c.json(await caller.agents.rotate({ agentId: c.req.param("id") })),
  ),
);

agents.delete("/:id", (c) =>
  withCallerResult(c, async (caller) =>
    c.json(await caller.agents.revoke({ agentId: c.req.param("id") })),
  ),
);

export { agents as agentRoutes };

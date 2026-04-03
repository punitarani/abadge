import { Hono } from "hono";
import { readJsonBody, withCallerResult } from "../lib/rest-helpers.js";
import type { Bindings } from "../types.js";

const permissions = new Hono<{ Bindings: Bindings }>();

permissions.get("/", (c) =>
  withCallerResult(c, async (caller) =>
    c.json(
      await caller.permissions.list({
        ...(c.req.query("agentId") ? { agentId: c.req.query("agentId") } : {}),
        ...(c.req.query("itemId") ? { itemId: c.req.query("itemId") } : {}),
      }),
    ),
  ),
);

permissions.post("/", (c) =>
  withCallerResult(c, async (caller) => {
    const body = await readJsonBody<Record<string, unknown>>(c.req.raw);
    return c.json(await caller.permissions.create(body), 201);
  }),
);

permissions.delete("/:id", (c) =>
  withCallerResult(c, async (caller) =>
    c.json(await caller.permissions.revoke({ permissionId: c.req.param("id") })),
  ),
);

export { permissions as permissionRoutes };

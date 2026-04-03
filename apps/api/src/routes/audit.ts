import { Hono } from "hono";
import { readOptionalInt, withCallerResult } from "../lib/rest-helpers.js";
import type { Bindings } from "../types.js";

const audit = new Hono<{ Bindings: Bindings }>();

audit.get("/", (c) =>
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

export { audit as auditRoutes };

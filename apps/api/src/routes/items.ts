import { Hono } from "hono";
import { readJsonBody, withCallerResult } from "../lib/rest-helpers.js";
import type { Bindings } from "../types.js";

const items = new Hono<{ Bindings: Bindings }>();

items.post("/", (c) =>
  withCallerResult(c, async (caller) => {
    const body = await readJsonBody<Record<string, unknown>>(c.req.raw);
    return c.json(await caller.items.create(body), 201);
  }),
);

items.get("/", (c) => withCallerResult(c, async (caller) => c.json(await caller.items.list())));

items.get("/:itemId", (c) =>
  withCallerResult(c, async (caller) =>
    c.json(await caller.items.get({ itemId: c.req.param("itemId") })),
  ),
);

items.put("/:itemId", (c) =>
  withCallerResult(c, async (caller) => {
    const body = await readJsonBody<Record<string, unknown>>(c.req.raw);
    return c.json(await caller.items.update({ itemId: c.req.param("itemId"), data: body }));
  }),
);

items.delete("/:itemId", (c) =>
  withCallerResult(c, async (caller) =>
    c.json(await caller.items.delete({ itemId: c.req.param("itemId") })),
  ),
);

export { items as itemRoutes };

import { Hono } from "hono";
import { readJsonBody, withCallerResult } from "../lib/rest-helpers.js";
import type { Bindings } from "../types.js";

const access = new Hono<{ Bindings: Bindings }>();

access.post("/ciphertext", (c) =>
  withCallerResult(c, async (caller) => {
    const body = await readJsonBody<Record<string, unknown>>(c.req.raw);
    return c.json(await caller.access.ciphertext(body));
  }),
);

access.post("/reveal", (c) =>
  withCallerResult(c, async (caller) => {
    const body = await readJsonBody<Record<string, unknown>>(c.req.raw);
    return c.json(await caller.access.reveal(body));
  }),
);

access.post("/mount", (c) =>
  withCallerResult(c, async (caller) => {
    const body = await readJsonBody<Record<string, unknown>>(c.req.raw);
    return c.json(await caller.access.mount(body));
  }),
);

export { access as accessRoutes };

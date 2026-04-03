import { Hono } from "hono";
import { readJsonBody, withCallerResult } from "../lib/rest-helpers.js";
import type { Bindings } from "../types.js";

const vault = new Hono<{ Bindings: Bindings }>();

vault.post("/bootstrap", (c) =>
  withCallerResult(c, async (caller) => {
    const body = await readJsonBody<Record<string, unknown>>(c.req.raw);
    return c.json(await caller.vault.bootstrap(body), 201);
  }),
);

vault.get("/", (c) => withCallerResult(c, async (caller) => c.json(await caller.vault.get())));

vault.post("/change-password", (c) =>
  withCallerResult(c, async (caller) => {
    const body = await readJsonBody<Record<string, unknown>>(c.req.raw);
    return c.json(await caller.vault.changePassword(body));
  }),
);

vault.post("/recovery", (c) =>
  withCallerResult(c, async (caller) => {
    const body = await readJsonBody<Record<string, unknown>>(c.req.raw);
    return c.json(await caller.vault.setupRecovery(body));
  }),
);

vault.post("/rotate-key", (c) =>
  withCallerResult(c, async (caller) => {
    const body = await readJsonBody<Record<string, unknown>>(c.req.raw);
    return c.json(await caller.vault.rotateKey(body));
  }),
);

export { vault as vaultRoutes };

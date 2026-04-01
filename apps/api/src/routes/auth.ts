import { getEnabledSocialProviders } from "@abadge/auth";
import { Hono } from "hono";
import type { Env } from "../types";

export const authRoutes = new Hono<Env>().get("/providers", async (c) => {
  return c.json({ providers: getEnabledSocialProviders(c.env) });
});

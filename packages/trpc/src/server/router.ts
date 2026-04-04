import { createTrpcRouter } from "./init";
import { accessRouter } from "./routers/access";
import { agentsRouter } from "./routers/agents";
import { auditRouter } from "./routers/audit";
import { authRouter } from "./routers/auth";
import { itemsRouter } from "./routers/items";
import { permissionsRouter } from "./routers/permissions";
import { vaultRouter } from "./routers/vault";

export const appRouter = createTrpcRouter({
  auth: authRouter,
  vault: vaultRouter,
  items: itemsRouter,
  agents: agentsRouter,
  permissions: permissionsRouter,
  access: accessRouter,
  audit: auditRouter,
});

export type AppRouter = typeof appRouter;

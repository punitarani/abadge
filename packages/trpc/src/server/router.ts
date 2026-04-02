import { createTrpcRouter } from "./init";
import { accessRouter } from "./routers/access";
import { auditRouter } from "./routers/audit";
import { grantsRouter } from "./routers/grants";
import { itemsRouter } from "./routers/items";
import { principalsRouter } from "./routers/principals";
import { vaultRouter } from "./routers/vault";

export const appRouter = createTrpcRouter({
  vault: vaultRouter,
  items: itemsRouter,
  principals: principalsRouter,
  grants: grantsRouter,
  access: accessRouter,
  audit: auditRouter,
});

export type AppRouter = typeof appRouter;

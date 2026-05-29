import { createTrpcRouter } from "./init";
import { accessRouter } from "./routers/access";
import { agentsRouter } from "./routers/agents";
import { apiKeysRouter } from "./routers/api-keys";
import { auditRouter } from "./routers/audit";
import { authRouter } from "./routers/auth";
import { itemsRouter } from "./routers/items";
import { onboardingRouter } from "./routers/onboarding";
import { organizationsRouter } from "./routers/organizations";
import { permissionsRouter } from "./routers/permissions";
import { profilesRouter } from "./routers/profiles";

export const appRouter = createTrpcRouter({
  auth: authRouter,
  profiles: profilesRouter,
  organizations: organizationsRouter,
  onboarding: onboardingRouter,
  items: itemsRouter,
  agents: agentsRouter,
  apiKeys: apiKeysRouter,
  permissions: permissionsRouter,
  access: accessRouter,
  audit: auditRouter,
});

export type AppRouter = typeof appRouter;

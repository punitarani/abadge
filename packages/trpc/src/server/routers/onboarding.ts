import { Schema } from "effect";
import { strictSchema } from "../effect";
import { createTrpcRouter, userProcedure } from "../init";

/**
 * Onboarding status, retained as a compatibility shim.
 *
 * §REVAMP-PR3 Task 5.2 — the onboarding-completeness gate was removed.
 * `organizations.create` (Task 5.1) auto-seeds a default `server_managed`
 * profile so an org is usable on first call. The web dashboard and the
 * `/device/approve` page already fail-open on any status-fetch error, so
 * unconditionally reporting `complete: true` keeps them on the happy path
 * without forcing a coordinated client-side rollout to delete this call.
 *
 * Procedure can be deleted once all `apps/web` callers stop reading
 * `onboarding.status`.
 */
const OnboardingStatusResultSchema = Schema.Struct({
  complete: Schema.Boolean,
});

export const onboardingRouter = createTrpcRouter({
  status: userProcedure
    .output(strictSchema(OnboardingStatusResultSchema))
    .query(() => ({ complete: true })),
});

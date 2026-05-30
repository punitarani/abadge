import { Schema } from "effect";
import { strictSchema } from "../effect";
import { createTrpcRouter, userProcedure } from "../init";

/**
 * Onboarding status, retained as a compatibility shim.
 *
 * There is no onboarding-completeness gate: `organizations.create` auto-seeds a
 * default `server_managed` profile, so an org is usable on first call. This
 * procedure unconditionally reports `complete: true`. The web dashboard and the
 * `/device/approve` page fail-open on any status-fetch error, so the shim keeps
 * them on the happy path. It can be deleted once all `apps/web` callers stop
 * reading `onboarding.status`.
 */
const OnboardingStatusResultSchema = Schema.Struct({
  complete: Schema.Boolean,
});

export const onboardingRouter = createTrpcRouter({
  status: userProcedure
    .output(strictSchema(OnboardingStatusResultSchema))
    .query(() => ({ complete: true })),
});

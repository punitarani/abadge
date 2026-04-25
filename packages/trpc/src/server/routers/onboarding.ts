import { Schema } from "effect";
import { strictSchema } from "../effect";
import { createTrpcRouter, userProcedure } from "../init";
import { userHasUsableOrg } from "../onboarding-gate";

/**
 * Small public surface for onboarding state. Intentionally uses
 * `userProcedure` so an under-onboarded user can still query their own
 * status — the whole point is to decide whether to gate their CLI login or
 * show them the onboarding flow.
 */

const OnboardingStatusResultSchema = Schema.Struct({
  complete: Schema.Boolean,
});

export const onboardingRouter = createTrpcRouter({
  status: userProcedure
    .output(strictSchema(OnboardingStatusResultSchema))
    .query(async ({ ctx }) => ({
      complete: await userHasUsableOrg(ctx.db, ctx.identity.userId),
    })),
});

import { ForbiddenError } from "@abadge/core";
import { initTRPC } from "@trpc/server";
import { Effect } from "effect";
import { resolveAgentIdentity, resolveSessionIdentity } from "./auth";
import type { AgentRequestContext, BaseRequestContext, SessionRequestContext } from "./context";
import { getTrpcErrorData, toTrpcError } from "./errors";
import type { OperatorTokenScope } from "./operator-token";

const t = initTRPC.context<BaseRequestContext>().create({
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        ...getTrpcErrorData(error),
      },
    };
  },
});

export const createTrpcRouter = t.router;
export const createTrpcCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure;

export const sessionProcedure = publicProcedure.use(async ({ ctx, next }) => {
  try {
    const identity = await Effect.runPromise(resolveSessionIdentity(ctx));
    return next({
      ctx: {
        ...ctx,
        identity,
      } satisfies SessionRequestContext,
    });
  } catch (error) {
    throw toTrpcError(error);
  }
});

export const scopedSessionProcedure = (scope: OperatorTokenScope) =>
  sessionProcedure.use(({ ctx, next }) => {
    if (ctx.identity.authMethod === "operator_token" && !ctx.identity.scopes?.includes(scope)) {
      throw toTrpcError(
        new ForbiddenError({
          code: "PERMISSION_DENIED",
          message: `Operator token is missing required scope: ${scope}`,
          hint: "Use a session token with broader access or mint a legacy operator token with the required scope.",
        }),
      );
    }

    return next({ ctx });
  });

export const agentProcedure = publicProcedure.use(async ({ ctx, next }) => {
  try {
    const identity = await Effect.runPromise(resolveAgentIdentity(ctx));
    return next({
      ctx: {
        ...ctx,
        identity,
      } satisfies AgentRequestContext,
    });
  } catch (error) {
    throw toTrpcError(error);
  }
});

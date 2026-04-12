import { initTRPC } from "@trpc/server";
import { Effect } from "effect";
import { resolveAgentIdentity, resolveSessionIdentity } from "./auth";
import type { AgentRequestContext, BaseRequestContext, SessionRequestContext } from "./context";
import { getTrpcErrorData, toTrpcError } from "./errors";

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

export const scopedSessionProcedure = (_scope: string) => sessionProcedure;

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

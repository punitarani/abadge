import { initTRPC } from "@trpc/server";
import { Effect } from "effect";
import { resolvePrincipalIdentity, resolveSessionIdentity } from "./auth";
import type { BaseRequestContext, PrincipalRequestContext, SessionRequestContext } from "./context";
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

export const principalProcedure = publicProcedure.use(async ({ ctx, next }) => {
  try {
    const identity = await Effect.runPromise(resolvePrincipalIdentity(ctx));
    return next({
      ctx: {
        ...ctx,
        identity,
      } satisfies PrincipalRequestContext,
    });
  } catch (error) {
    throw toTrpcError(error);
  }
});

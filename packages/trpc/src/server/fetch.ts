import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { AppBindings } from "./context";
import { createRequestContext } from "./context";
import { createTrpcCallerFactory } from "./init";
import { appRouter } from "./router";

export function handleTrpcRequest(
  req: Request,
  env: AppBindings,
  endpoint = "/trpc",
): Promise<Response> {
  return fetchRequestHandler({
    endpoint,
    req,
    router: appRouter,
    createContext({ req, resHeaders }) {
      return createRequestContext({ req, resHeaders, env });
    },
  });
}

export function createServerCaller(req: Request, env: AppBindings) {
  const ctx = createRequestContext({ req, resHeaders: new Headers(), env });
  return createTrpcCallerFactory(appRouter)(ctx);
}

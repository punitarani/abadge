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

export function createServerCallerContext(req: Request, env: AppBindings) {
  const resHeaders = new Headers();
  const ctx = createRequestContext({ req, resHeaders, env });

  return {
    caller: createTrpcCallerFactory(appRouter)(ctx),
    resHeaders,
  };
}

export function createServerCaller(req: Request, env: AppBindings) {
  return createServerCallerContext(req, env).caller;
}

import type { Database } from "@abadge/db";
import type { AppBindings, BaseRequestContext } from "../../context";
import { createTrpcCallerFactory } from "../../init";
import { appRouter } from "../../router";
import type { TestAuth } from "./test-auth";
import { TEST_ENV } from "./test-env";

const callerFactory = createTrpcCallerFactory(appRouter);

export function createOperatorCaller(
  db: Database,
  auth: TestAuth,
  headers: Headers,
  orgId?: string,
) {
  const requestHeaders = new Headers(headers);
  if (orgId) {
    requestHeaders.set("x-abadge-org-id", orgId);
  }

  const ctx: BaseRequestContext = {
    req: new Request("http://test", { headers: requestHeaders }),
    resHeaders: new Headers(),
    env: { ...TEST_ENV } as AppBindings,
    validatedEnv: TEST_ENV,
    db,
    auth,
    ipAddress: "127.0.0.1",
  };

  return callerFactory(ctx);
}

export function createAgentCaller(
  db: Database,
  auth: TestAuth,
  rawToken: string,
) {
  const headers = new Headers();
  headers.set("authorization", `Bearer ${rawToken}`);

  const ctx: BaseRequestContext = {
    req: new Request("http://test", { headers }),
    resHeaders: new Headers(),
    env: { ...TEST_ENV } as AppBindings,
    validatedEnv: TEST_ENV,
    db,
    auth,
    ipAddress: "127.0.0.1",
  };

  return callerFactory(ctx);
}

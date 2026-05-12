import { afterAll, afterEach, beforeAll } from "bun:test";
import { type ApiServerHandle, startApiServer } from "./api-server";
import { migrateTestDb, truncateAll } from "./postgres";

/**
 * Shared lifecycle for an e2e suite: migrate the test DB once, boot a
 * single wrangler-dev API server for the file, truncate between tests,
 * tear down at the end. Returns a getter so tests can read `apiUrl()` /
 * `apiServer()` lazily without dealing with `let` + non-null asserts.
 */
export interface TestStack {
  apiServer(): ApiServerHandle;
  apiUrl(): string;
}

export function useTestStack(): TestStack {
  let server: ApiServerHandle | null = null;

  beforeAll(async () => {
    await migrateTestDb();
    server = await startApiServer();
  });

  afterEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  return {
    apiServer() {
      if (!server) throw new Error("test stack not started — beforeAll did not run");
      return server;
    },
    apiUrl() {
      if (!server) throw new Error("test stack not started — beforeAll did not run");
      return server.url;
    },
  };
}

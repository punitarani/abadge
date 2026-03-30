import { createDb, type Database } from "@abadge/db";
import type { Bindings } from "../types";

export function getConnectionString(env: Bindings): string {
  if (env.HYPERDRIVE) {
    return env.HYPERDRIVE.connectionString;
  }
  if (env.DATABASE_URL) {
    return env.DATABASE_URL;
  }
  throw new Error("No database connection: set HYPERDRIVE binding or DATABASE_URL");
}

export function getDb(connectionString: string): Database {
  // Create a fresh connection per request — Workers isolate I/O per request context
  return createDb(connectionString);
}

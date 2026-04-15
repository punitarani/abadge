// Re-export drizzle-orm operators so consumers don't need a direct drizzle-orm dependency

export type { SQL } from "drizzle-orm";
export {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
export { migrate } from "drizzle-orm/postgres-js/migrator";
export { createDb, type Database } from "./client";
export * from "./roadmap-backfill";
export * from "./schema";

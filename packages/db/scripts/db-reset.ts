#!/usr/bin/env bun
/**
 * Drops all tables and re-runs migrations against the local database.
 * Requires interactive confirmation to prevent accidental data loss.
 */
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { execSync } from "node:child_process";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const rl = createInterface({ input: stdin, output: stdout });
const answer = await rl.question(
  "This will DROP all tables and re-run migrations. Type YES to confirm: ",
);
rl.close();

if (answer !== "YES") {
  console.log("Aborted.");
  process.exit(0);
}

try {
  console.log("Dropping schema...");
  execSync(`psql "${databaseUrl}" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"`, {
    stdio: "inherit",
  });

  console.log("Running migrations...");
  execSync("drizzle-kit migrate", { stdio: "inherit" });

  console.log("Database reset complete.");
} catch {
  console.error("Reset failed.");
  process.exit(1);
}

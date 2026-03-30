import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs in Node.js (not Workers), so process.env is appropriate here
// biome-ignore lint/style/noRestrictedGlobals: drizzle-kit config runs in Node.js
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for drizzle-kit");
}

export default defineConfig({
  out: "./migrations",
  schema: "./src/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});

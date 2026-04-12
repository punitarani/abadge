import type { WorkerEnv } from "@abadge/env/worker";

/**
 * Test environment that satisfies the WorkerEnv schema.
 * ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef" (32 ASCII chars = 32 bytes) base64-encoded.
 */
export const TEST_ENV: WorkerEnv = {
  ABADGE_API_URL: "http://localhost:8787",
  ABADGE_APP_URL: "http://localhost:3000",
  ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
  BETTER_AUTH_SECRET: "test-better-auth-secret-at-least-32-chars-long!!",
  GOOGLE_CLIENT_ID: "test-google-client-id",
  GOOGLE_CLIENT_SECRET: "test-google-client-secret",
  GITHUB_CLIENT_ID: "test-github-client-id",
  GITHUB_CLIENT_SECRET: "test-github-client-secret",
};

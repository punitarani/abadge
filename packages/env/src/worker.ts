import { z } from "zod";

/**
 * Schema for Cloudflare Worker environment bindings.
 * Workers don't use process.env — bindings are passed per-request via `c.env`.
 * Use `validateWorkerEnv(env)` at the start of a request to validate.
 */
const workerEnvSchema = z.object({
  API_URL: z.string().url(),
  APP_URL: z.string().url(),
  ENCRYPTION_KEY: z.string().min(1),
  BETTER_AUTH_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(1),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function validateWorkerEnv(env: Record<string, unknown>): WorkerEnv {
  return workerEnvSchema.parse(env);
}

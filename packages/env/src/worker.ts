import { z } from "zod";

/**
 * Schema for Cloudflare Worker environment bindings.
 * Workers don't use process.env — bindings are passed per-request via `c.env`.
 * Canonical URL bindings are `ABADGE_API_URL` and `ABADGE_APP_URL`.
 * `validateWorkerEnv(env)` still accepts legacy `API_URL` / `APP_URL` and normalizes them.
 */
const optionalSecret = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}, z.string().min(1).optional());

const workerEnvSchema = z.object({
  ABADGE_API_URL: z.string().url(),
  ABADGE_APP_URL: z.string().url(),
  ENCRYPTION_KEY: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(1),
  GOOGLE_CLIENT_ID: optionalSecret,
  GOOGLE_CLIENT_SECRET: optionalSecret,
  GITHUB_CLIENT_ID: optionalSecret,
  GITHUB_CLIENT_SECRET: optionalSecret,
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function validateWorkerEnv(env: Record<string, unknown>): WorkerEnv {
  return workerEnvSchema.parse({
    ...env,
    ABADGE_API_URL: env.ABADGE_API_URL ?? env.API_URL,
    ABADGE_APP_URL: env.ABADGE_APP_URL ?? env.APP_URL,
  });
}

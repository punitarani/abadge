import { z } from "zod";

const AES_256_KEY_BYTES = 32;

function base64DecodedLength(value: string): number {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return atob(padded).length;
}

/**
 * Schema for Cloudflare Worker environment bindings.
 * Workers don't use process.env — bindings are passed per-request via `c.env`.
 * Canonical URL bindings are `ABADGE_API_URL` and `ABADGE_APP_URL`.
 * `validateWorkerEnv(env)` still accepts legacy `API_URL` / `APP_URL` and normalizes them.
 */
const workerEnvSchema = z.object({
  ABADGE_API_URL: z.string().url(),
  ABADGE_APP_URL: z.string().url(),
  ENCRYPTION_KEY: z
    .string()
    .min(1)
    .refine(
      (val) => {
        try {
          return base64DecodedLength(val) === AES_256_KEY_BYTES;
        } catch {
          return false;
        }
      },
      (val) => {
        try {
          const len = base64DecodedLength(val);
          return {
            message: `ENCRYPTION_KEY must decode to exactly ${AES_256_KEY_BYTES} bytes (AES-256), got ${len} bytes`,
          };
        } catch {
          return { message: "ENCRYPTION_KEY is not valid base64" };
        }
      },
    ),
  BETTER_AUTH_SECRET: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  // Optional transactional-email sender overrides. Default sender is
  // `no-reply@notifications.abadge.io` (see packages/auth mailer). Override only
  // with an address on a Cloudflare Email Routing-verified sending domain.
  ABADGE_EMAIL_FROM: z.string().min(1).optional(),
  ABADGE_EMAIL_FROM_NAME: z.string().min(1).optional(),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function validateWorkerEnv(env: Record<string, unknown>): WorkerEnv {
  return workerEnvSchema.parse({
    ...env,
    ABADGE_API_URL: env.ABADGE_API_URL ?? env.API_URL,
    ABADGE_APP_URL: env.ABADGE_APP_URL ?? env.APP_URL,
  });
}

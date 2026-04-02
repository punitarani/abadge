import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * `ABADGE_*` is the canonical URL contract across the repo.
 * Keep `NEXT_PUBLIC_*` as a legacy fallback for existing Next.js environments.
 */
function resolvePublicApiUrl(): string {
  const v = process.env.ABADGE_API_URL || process.env.NEXT_PUBLIC_API_URL;
  return v || "http://localhost:8787";
}

function resolvePublicAppUrl(): string {
  const v = process.env.ABADGE_APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  return v || "http://localhost:3000";
}

const rawClientEnv = createEnv({
  client: {
    NEXT_PUBLIC_API_URL: z.string().url(),
    NEXT_PUBLIC_APP_URL: z.string().url(),
  },
  runtimeEnv: {
    NEXT_PUBLIC_API_URL: resolvePublicApiUrl(),
    NEXT_PUBLIC_APP_URL: resolvePublicAppUrl(),
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION || process.env.NODE_ENV === "development",
  emptyStringAsUndefined: true,
});

export const clientEnv = {
  ABADGE_API_URL: rawClientEnv.NEXT_PUBLIC_API_URL,
  ABADGE_APP_URL: rawClientEnv.NEXT_PUBLIC_APP_URL,
} as const;

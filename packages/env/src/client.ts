import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/** Prefer NEXT_PUBLIC_* (Next inlining / .env.local); fall back to ABADGE_* (turbo/CLI); then local dev defaults. */
function resolvePublicApiUrl(): string {
  const v = process.env.NEXT_PUBLIC_API_URL || process.env.ABADGE_API_URL;
  return v || "http://localhost:8787";
}

function resolvePublicAppUrl(): string {
  const v = process.env.NEXT_PUBLIC_APP_URL || process.env.ABADGE_APP_URL;
  return v || "http://localhost:3000";
}

export const clientEnv = createEnv({
  client: {
    NEXT_PUBLIC_API_URL: z.string().url(),
    NEXT_PUBLIC_APP_URL: z.string().url(),
  },
  runtimeEnv: {
    NEXT_PUBLIC_API_URL: resolvePublicApiUrl(),
    NEXT_PUBLIC_APP_URL: resolvePublicAppUrl(),
  },
  // Skip validation during build / SSR prerender — validated at runtime in the browser
  skipValidation: !!process.env.SKIP_ENV_VALIDATION || process.env.NODE_ENV === "production",
  emptyStringAsUndefined: true,
});

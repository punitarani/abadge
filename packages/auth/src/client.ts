import { apiKeyClient } from "@better-auth/api-key/client";
import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export type SocialProvider = "github" | "google";

export const SOCIAL_PROVIDERS: readonly SocialProvider[] = ["github", "google"] as const;

// biome-ignore lint/suspicious/noExplicitAny: Better Auth inferred type references non-portable internal paths
export function createBetterAuthClient(baseURL: string): any {
  return createAuthClient({
    baseURL,
    fetchOptions: {
      credentials: "include",
    },
    // biome-ignore lint/suspicious/noExplicitAny: duplicate @better-auth/core resolutions cause nominal type mismatch
    plugins: [organizationClient(), apiKeyClient()] as any[],
  });
}

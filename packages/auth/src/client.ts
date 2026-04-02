import { apiKeyClient } from "@better-auth/api-key/client";
import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export type SocialProvider = "github" | "google";

export const SOCIAL_PROVIDERS: readonly SocialProvider[] = ["github", "google"] as const;

interface AuthErrorResult {
  error: { message?: string } | null;
}

/** Portable subset of Better Auth's client covering the methods used in the dashboard. */
export interface BetterAuthClient {
  signIn: {
    email: (data: { email: string; password: string }) => Promise<AuthErrorResult>;
    social: (data: {
      provider: string;
      callbackURL: string;
      errorCallbackURL: string;
    }) => Promise<AuthErrorResult>;
  };
  signUp: {
    email: (data: { name: string; email: string; password: string }) => Promise<AuthErrorResult>;
  };
  signOut: () => Promise<unknown>;
  useSession: () => {
    data: { user: Record<string, unknown>; session: Record<string, unknown> } | null;
    isPending: boolean;
  };
}

export function createBetterAuthClient(baseURL: string): BetterAuthClient {
  return createAuthClient({
    baseURL,
    fetchOptions: {
      credentials: "include",
    },
    // biome-ignore lint/suspicious/noExplicitAny: duplicate @better-auth/core resolutions cause nominal type mismatch
    plugins: [organizationClient(), apiKeyClient()] as any[],
  }) as unknown as BetterAuthClient;
}

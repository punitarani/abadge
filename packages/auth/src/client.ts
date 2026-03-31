import { apiKeyClient } from "@better-auth/api-key/client";
import { createAuthClient } from "better-auth/client";
import { organizationClient } from "better-auth/client/plugins";

export function createBetterAuthClient(baseURL: string) {
  const options = {
    baseURL,
    plugins: [organizationClient(), apiKeyClient()],
  } as Parameters<typeof createAuthClient>[0];

  return createAuthClient(options);
}

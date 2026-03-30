import { apiKeyClient } from "@better-auth/api-key/client";
import { createAuthClient } from "better-auth/client";
import { organizationClient } from "better-auth/client/plugins";

export function createBetterAuthClient(baseURL: string) {
  return createAuthClient({
    baseURL,
    plugins: [organizationClient(), apiKeyClient()],
  });
}

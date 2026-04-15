"use client";

import { clientEnv } from "@abadge/env/client";
import { createBrowserTrpcClient } from "@abadge/trpc/client";
import { useOrgStore } from "@/stores/org-store";

export { getClientErrorMessage } from "./client-error-message";

export const browserTrpcClient: ReturnType<typeof createBrowserTrpcClient> =
  createBrowserTrpcClient({
    baseUrl: clientEnv.ABADGE_API_URL,
    getOrgId: () => useOrgStore.getState().activeOrgId ?? undefined,
  });

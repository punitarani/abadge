"use client";

import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import { useState } from "react";
import { createBrowserTrpcClient, createTrpcQueryClient } from "./client";
import type { AppRouter } from "./server/router";

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

let browserQueryClient: QueryClient | undefined;

function getBrowserQueryClient(): QueryClient {
  if (!browserQueryClient) {
    browserQueryClient = createTrpcQueryClient();
  }
  return browserQueryClient;
}

export function TrpcReactProvider({
  baseUrl,
  children,
}: {
  baseUrl: string;
  children: React.ReactNode;
}): React.ReactElement {
  const queryClient = getBrowserQueryClient();
  const [trpcClient] = useState(() => createBrowserTrpcClient({ baseUrl }));

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}

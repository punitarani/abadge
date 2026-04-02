"use client";

import { clientEnv } from "@abadge/env/client";
import { TrpcReactProvider } from "@abadge/trpc/react";
import { QueryDevtools } from "@/components/query-devtools";

export function AppProviders({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <TrpcReactProvider baseUrl={clientEnv.ABADGE_API_URL}>
      {children}
      <QueryDevtools />
    </TrpcReactProvider>
  );
}

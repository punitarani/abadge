"use client";

import { clientEnv } from "@abadge/env/client";
import { TrpcReactProvider } from "@abadge/trpc/react";

export function AppProviders({ children }: { children: React.ReactNode }): React.ReactElement {
  return <TrpcReactProvider baseUrl={clientEnv.ABADGE_API_URL}>{children}</TrpcReactProvider>;
}

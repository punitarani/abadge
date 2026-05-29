"use client";

import { clientEnv } from "@abadge/env/client";
import { TrpcReactProvider } from "@abadge/trpc/react";
import { QueryDevtools } from "@/components/query-devtools";
import { ThemeProvider } from "@/components/theme-provider";

export function AppProviders({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange>
      <TrpcReactProvider baseUrl={clientEnv.ABADGE_API_URL}>
        {children}
        <QueryDevtools />
      </TrpcReactProvider>
    </ThemeProvider>
  );
}

"use client";

import { clientEnv } from "@abadge/env/client";
import dynamic from "next/dynamic";

const ReactQueryDevtools = dynamic(
  () => import("@tanstack/react-query-devtools").then((mod) => mod.ReactQueryDevtools),
  { ssr: false },
);

function isLocalDebugSession(): boolean {
  const hostname = new URL(clientEnv.ABADGE_APP_URL).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";
}

export function QueryDevtools(): React.ReactElement | null {
  if (!isLocalDebugSession()) {
    return null;
  }

  return <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />;
}

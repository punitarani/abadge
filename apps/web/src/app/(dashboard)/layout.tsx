"use client";

import { useRouter } from "next/navigation";
import Script from "next/script";
import { useEffect } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";
import { VaultProvider } from "@/lib/vault-context";

declare global {
  interface Window {
    uj: {
      init: (projectId: string, options: Record<string, unknown>) => void;
      identify: (user: Record<string, string | undefined>) => void;
    };
    $ujq: unknown[];
  }
}

function DashboardShell({
  children,
  panel,
}: {
  children: React.ReactNode;
  panel: React.ReactNode;
}): React.ReactElement {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <div className="px-8 py-6">{children}</div>
        {panel}
      </SidebarInset>
    </SidebarProvider>
  );
}

function AuthenticatedDashboard({
  children,
  panel,
}: {
  children: React.ReactNode;
  panel: React.ReactNode;
}): React.ReactElement {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (!isPending && !session) {
      router.push("/login");
    }
  }, [isPending, session, router]);

  useEffect(() => {
    if (session?.user) {
      window.uj.identify({
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
      });
    }
  }, [session?.user]);

  if (isPending || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <VaultProvider>
      <DashboardShell panel={panel}>{children}</DashboardShell>
      <Script id="userjot-loader" strategy="afterInteractive">
        {`window.$ujq=window.$ujq||[];window.uj=window.uj||new Proxy({},{get:(_,p)=>(...a)=>window.$ujq.push([p,...a])});document.head.appendChild(Object.assign(document.createElement('script'),{src:'https://cdn.userjot.com/sdk/v2/uj.js',type:'module',async:!0}));`}
      </Script>
      <Script id="userjot-init" strategy="afterInteractive">
        {`window.uj.init('cmnkcclu80xvr0io6ha14686u',{widget:true,position:'right',theme:'auto'});`}
      </Script>
    </VaultProvider>
  );
}

export default function DashboardLayout({
  children,
  panel,
}: {
  children: React.ReactNode;
  panel: React.ReactNode;
}): React.ReactElement {
  return <AuthenticatedDashboard panel={panel}>{children}</AuthenticatedDashboard>;
}

"use client";

import Script from "next/script";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SecretDisplay } from "@/components/ui/secret-display";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";
import { useVault, VaultProvider } from "@/lib/vault-context";

declare global {
  interface Window {
    uj: {
      init: (projectId: string, options: Record<string, unknown>) => void;
      identify: (user: Record<string, string | undefined>) => void;
    };
    $ujq: unknown[];
  }
}

function VaultGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const { isUnlocked, vaultExists, unlockVault, bootstrapVault, checkVaultExists } = useVault();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);

  useEffect(() => {
    if (vaultExists === null) {
      void checkVaultExists().catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load vault");
      });
    }
  }, [vaultExists, checkVaultExists]);

  if (vaultExists === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading vault...</div>
      </div>
    );
  }

  if (recoveryKey) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-1 text-center">
            <h1 className="text-xl font-semibold">Save your recovery key</h1>
            <p className="text-sm text-muted-foreground">
              Store this key somewhere safe. It is the only way to recover your vault if you forget
              your master password.
            </p>
          </div>

          <div className="border border-border rounded-lg p-5 space-y-4">
            <SecretDisplay value={recoveryKey} />

            <Button className="w-full" size="sm" onClick={() => setRecoveryKey(null)}>
              I have saved my recovery key
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (isUnlocked) {
    return <>{children}</>;
  }

  // Bootstrap flow for new users
  if (!vaultExists) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-1 text-center">
            <h1 className="text-xl font-semibold">Set up your vault</h1>
            <p className="text-sm text-muted-foreground">
              Choose a master password to encrypt your vault. This password never leaves your
              browser.
            </p>
          </div>

          <form
            className="border border-border rounded-lg p-5 space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              if (password.length < 8) {
                setError("Master password must be at least 8 characters");
                return;
              }
              if (password !== confirmPassword) {
                setError("Passwords do not match");
                return;
              }
              setLoading(true);
              try {
                const result = await bootstrapVault(password);
                setRecoveryKey(result.recoveryKey);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Bootstrap failed");
              } finally {
                setLoading(false);
              }
            }}
          >
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="mp-new">Master password</Label>
              <Input
                id="mp-new"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mp-confirm">Confirm password</Label>
              <Input
                id="mp-confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" size="sm" disabled={loading}>
              {loading ? "Creating vault..." : "Create vault"}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  // Unlock flow for existing users
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold">Unlock vault</h1>
          <p className="text-sm text-muted-foreground">
            Enter your master password to decrypt your vault.
          </p>
        </div>

        <form
          className="border border-border rounded-lg p-5 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setLoading(true);
            try {
              await unlockVault(password);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed to unlock vault");
            } finally {
              setLoading(false);
            }
          }}
        >
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="mp-unlock">Master password</Label>
            <Input
              id="mp-unlock"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="w-full" size="sm" disabled={loading}>
            {loading ? "Unlocking..." : "Unlock"}
          </Button>
        </form>
      </div>
    </div>
  );
}

function DashboardShell({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <div className="px-8 py-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function AuthenticatedDashboard({ children }: { children: React.ReactNode }): React.ReactElement {
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
      <VaultGate>
        <DashboardShell>{children}</DashboardShell>
      </VaultGate>
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
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <AuthenticatedDashboard>{children}</AuthenticatedDashboard>;
}

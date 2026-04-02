"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SecretDisplay } from "@/components/ui/secret-display";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { useVault, VaultProvider } from "@/lib/vault-context";

const navSections = [
  {
    label: "Vault",
    items: [{ href: "/items", label: "Items" }],
  },
  {
    label: "Access",
    items: [
      { href: "/agents", label: "Agents" },
      { href: "/permissions", label: "Permissions" },
    ],
  },
  {
    label: "Observability",
    items: [{ href: "/audit", label: "Audit log" }],
  },
  {
    label: "Account",
    items: [{ href: "/settings", label: "Settings" }],
  },
];

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
  const pathname = usePathname();
  const router = useRouter();
  const { lockVault } = useVault();

  async function handleSignOut(): Promise<void> {
    lockVault();
    await authClient.signOut();
    router.push("/login");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-border flex flex-col">
        <div className="px-4 h-14 flex items-center border-b border-border">
          <Link href="/items" className="text-sm font-semibold tracking-tight">
            abadge
          </Link>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {navSections.map((section, i) => (
            <div key={section.label}>
              <div
                className={cn(
                  "px-2 pb-2 text-xs font-semibold text-muted-foreground",
                  i === 0 ? "pt-1" : "pt-4",
                )}
              >
                {section.label}
              </div>
              {section.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center rounded-md px-2.5 py-1.5 text-sm transition-colors",
                    pathname.startsWith(item.href)
                      ? "bg-neutral-100 text-foreground font-medium"
                      : "text-muted-foreground hover:bg-neutral-50 hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="border-t border-border px-2 py-3 space-y-0.5">
          <button
            type="button"
            onClick={() => lockVault()}
            className="flex w-full items-center rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-neutral-50 hover:text-foreground"
          >
            Lock vault
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-neutral-50 hover:text-foreground"
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <div className="h-14 border-b border-border" />
        <div className="px-8 py-6">{children}</div>
      </main>
    </div>
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

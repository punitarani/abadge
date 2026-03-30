import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 h-14">
        <span className="text-sm font-semibold tracking-tight">abadge</span>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/login">Sign in</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/register">Get started</Link>
          </Button>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6">
        <div className="max-w-lg text-center space-y-4">
          <h1 className="text-3xl font-bold tracking-tight">One password for agents</h1>
          <p className="text-base text-muted-foreground leading-relaxed">
            Store credentials. Register agents. Grant access per secret. Audit every read.
          </p>
          <div className="flex justify-center gap-3 pt-2">
            <Button size="lg" asChild>
              <Link href="/register">Start for free</Link>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
        </div>

        <div className="mt-16 max-w-xl w-full">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div className="border border-border rounded-lg p-4">
              <div className="font-semibold mb-1">Encrypted storage</div>
              <div className="text-muted-foreground">
                AES-256-GCM at rest. Decrypted only on authorized reads.
              </div>
            </div>
            <div className="border border-border rounded-lg p-4">
              <div className="font-semibold mb-1">Per-credential access</div>
              <div className="text-muted-foreground">
                Explicit grants. No wildcards. No implicit access.
              </div>
            </div>
            <div className="border border-border rounded-lg p-4">
              <div className="font-semibold mb-1">Full audit trail</div>
              <div className="text-muted-foreground">
                Every allowed and denied read is logged permanently.
              </div>
            </div>
            <div className="border border-border rounded-lg p-4">
              <div className="font-semibold mb-1">Agent API keys</div>
              <div className="text-muted-foreground">
                Issued once. Hashed and stored. Bearer token access.
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-border px-6 py-4 text-center text-xs text-muted-foreground">
        abadge
      </footer>
    </div>
  );
}

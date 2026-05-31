import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";

export const metadata = { title: "Toolbar Preview" };

function SearchIcon() {
  return (
    <MagnifyingGlass className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
  );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1 mb-10">
      <p className="text-xs font-mono text-muted-foreground mb-3">{label}</p>
      <div className="rounded-xl border border-border bg-card p-6 space-y-6">
        {children}
      </div>
    </div>
  );
}

function Breadcrumb({ page }: { page: string }) {
  return (
    <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <span>Punit Arani's workspace</span>
      <span>/</span>
      <span className="text-foreground">{page}</span>
    </nav>
  );
}

export default function PreviewPage() {
  return (
    <div className="dark min-h-screen bg-background text-foreground p-10">
      <h2 className="text-base font-semibold mb-8">PR #243 — toolbar button alignment verification</h2>

      {/* BEFORE */}
      <Card label="❌ Before — button in title/header row (old layout on all 4 pages)">
        <Breadcrumb page="Items" />
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold">Items</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Encrypted credentials and secrets stored in your vault.
            </p>
          </div>
          <Button size="sm">
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add item
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-64">
            <SearchIcon />
            <Input placeholder="Search items..." className="pl-8" />
          </div>
          <select className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground">
            <option>All storage</option>
          </select>
        </div>
      </Card>

      {/* AFTER: Items */}
      <Card label="✅ After — Items: button in filters row, right-aligned">
        <Breadcrumb page="Items" />
        <div>
          <h1 className="text-lg font-semibold">Items</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Encrypted credentials and secrets stored in your vault.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-64">
            <SearchIcon />
            <Input placeholder="Search items..." className="pl-8" />
          </div>
          <select className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground">
            <option>All storage</option>
          </select>
          <Button size="sm" className="ml-auto h-9">
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add item
          </Button>
        </div>
      </Card>

      {/* AFTER: Agents */}
      <Card label="✅ After — Agents: button in filters row, right-aligned">
        <Breadcrumb page="Agents" />
        <div>
          <h1 className="text-lg font-semibold">Agents</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Automated callers scoped to this organization. Each agent can only access items it has been explicitly granted permission for.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-64">
            <SearchIcon />
            <Input placeholder="Search agents..." className="pl-8" />
          </div>
          <select className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground">
            <option>All kinds</option>
          </select>
          <select className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground">
            <option>All status</option>
          </select>
          <Button size="sm" className="ml-auto h-9">
            <Plus className="mr-1 h-3.5 w-3.5" />
            Register agent
          </Button>
        </div>
      </Card>

      {/* AFTER: Permissions */}
      <Card label="✅ After — Permissions: button in filters row, right-aligned">
        <Breadcrumb page="Permissions" />
        <div>
          <h1 className="text-lg font-semibold">Permissions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Each row is one (agent, item) pair. Capabilities are explicit grants — revoke any chip individually.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-64">
            <SearchIcon />
            <Input placeholder="Search agent or item..." className="pl-8" />
          </div>
          <select className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground">
            <option>All agents</option>
          </select>
          <select className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground">
            <option>All capabilities</option>
          </select>
          <select className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground">
            <option>All expiry</option>
          </select>
          <Button size="sm" className="ml-auto h-9">
            <Plus className="mr-1 h-3.5 w-3.5" />
            Grant permission
          </Button>
        </div>
      </Card>

      {/* AFTER: Profiles */}
      <Card label="✅ After — Profiles: button in filters row, right-aligned (team orgs only)">
        <Breadcrumb page="Profiles" />
        <div>
          <h1 className="text-lg font-semibold">Profiles</h1>
          <p className="text-sm text-muted-foreground">
            Encryption boundaries within your organization. Each profile is a separate vault.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] max-w-xs flex-1">
            <MagnifyingGlass className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search profiles..." className="h-8 pl-8 text-sm" />
          </div>
          <select className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground">
            <option>All storage</option>
          </select>
          <select className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground">
            <option>All vault status</option>
          </select>
          <span className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground">1 profiles</span>
          <Button size="sm" className="ml-auto">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New profile
          </Button>
        </div>
      </Card>
    </div>
  );
}

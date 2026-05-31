"use client";

import type { Agent, AgentKind } from "@abadge/core";
import { MagnifyingGlass, Plus, X } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { debounce, useQueryStates } from "nuqs";
import { useMemo } from "react";
import { CreateAgentPanel } from "@/components/dashboard/create-agent-panel";
import { TableRowsSkeleton } from "@/components/dashboard/skeletons/table-rows-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listAllAgents } from "@/lib/list-queries";
import { dashboardQueryKeys } from "@/lib/query-keys";
import {
  type AgentKindFilter,
  type AgentStatusFilter,
  agentsFilterParsers,
} from "@/lib/query-state";
import { formatRelativeTime } from "@/lib/utils";
import { useOrgStore } from "@/stores/org-store";

const KIND_LABELS: Record<AgentKind, string> = {
  local_cli: "CLI",
  local_mcp: "MCP",
  remote: "Remote",
};

function KindBadge({ kind }: { kind: AgentKind }): React.ReactElement {
  const styles: Record<AgentKind, string> = {
    local_cli: "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
    local_mcp: "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
    remote: "bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  };

  return (
    <Badge variant="outline" className={`border-transparent text-[11px] ${styles[kind]}`}>
      {KIND_LABELS[kind]}
    </Badge>
  );
}

function StatusBadge({ agent }: { agent: Agent }): React.ReactElement {
  if (agent.revokedAt) {
    return <Badge variant="destructive">Revoked</Badge>;
  }
  return <Badge variant="success">Active</Badge>;
}

export default function AgentsListPage(): React.ReactElement {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const activeOrgName = useOrgStore((s) => s.activeOrgName);

  const [filters, setFilters] = useQueryStates(agentsFilterParsers, {
    history: "replace",
    clearOnDefault: true,
    limitUrlUpdates: debounce(250),
  });
  const { q: search, kind: kindFilter, status: statusFilter, create: createOpen } = filters;

  const agentsQuery = useQuery({
    queryKey: dashboardQueryKeys.orgAgents(activeOrgId ?? ""),
    queryFn: () => listAllAgents(),
    enabled: !!activeOrgId,
  });

  const agents = agentsQuery.data?.agents ?? [];

  const filteredAgents = useMemo(() => {
    let result = agents;

    if (search) {
      const lower = search.toLowerCase();
      result = result.filter((agent: Agent) => agent.name.toLowerCase().includes(lower));
    }

    if (kindFilter !== "all") {
      result = result.filter((agent: Agent) => agent.kind === kindFilter);
    }

    if (statusFilter !== "all") {
      if (statusFilter === "active") {
        result = result.filter((agent: Agent) => !agent.revokedAt);
      } else {
        result = result.filter((agent: Agent) => !!agent.revokedAt);
      }
    }

    return result;
  }, [agents, search, kindFilter, statusFilter]);

  const hasActiveFilters = search !== "" || kindFilter !== "all" || statusFilter !== "all";

  function clearFilters(): void {
    void setFilters({ q: "", kind: "all", status: "all" });
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/overview" className="hover:text-foreground">
          {activeOrgName}
        </Link>
        <span>/</span>
        <span className="text-foreground">Agents</span>
      </nav>

      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold">Agents</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Automated callers scoped to this organization. Each agent can only access items it has
          been explicitly granted permission for.
        </p>
      </div>

      {/* Search and filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <MagnifyingGlass className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search agents..."
            value={search}
            onChange={(e) => void setFilters({ q: e.target.value })}
            className="pl-8"
          />
        </div>

        <Select
          value={kindFilter}
          onValueChange={(v) => void setFilters({ kind: v as AgentKindFilter })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All kinds</SelectItem>
            <SelectItem value="local_cli">CLI</SelectItem>
            <SelectItem value="local_mcp">MCP</SelectItem>
            <SelectItem value="remote">Remote</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={statusFilter}
          onValueChange={(v) => void setFilters({ status: v as AgentStatusFilter })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="revoked">Revoked</SelectItem>
          </SelectContent>
        </Select>

        <Button size="sm" onClick={() => void setFilters({ create: true })} className="ml-auto h-9">
          <Plus className="mr-1 h-3.5 w-3.5" />
          Register agent
        </Button>
      </div>

      {/* Active filter chips */}
      {hasActiveFilters && (
        <FilterChips
          search={search}
          kindFilter={kindFilter}
          statusFilter={statusFilter}
          onClearSearch={() => void setFilters({ q: "" })}
          onClearKind={() => void setFilters({ kind: "all" })}
          onClearStatus={() => void setFilters({ status: "all" })}
          onClearAll={clearFilters}
        />
      )}

      {/* Agents table */}
      <AgentsTable
        isPending={agentsQuery.isPending}
        agents={filteredAgents}
        totalCount={agents.length}
      />

      <CreateAgentPanel open={createOpen} onClose={() => void setFilters({ create: false })} />
    </div>
  );
}

/* ---- Sub-components ---- */

function FilterChips({
  search,
  kindFilter,
  statusFilter,
  onClearSearch,
  onClearKind,
  onClearStatus,
  onClearAll,
}: {
  search: string;
  kindFilter: AgentKindFilter;
  statusFilter: AgentStatusFilter;
  onClearSearch: () => void;
  onClearKind: () => void;
  onClearStatus: () => void;
  onClearAll: () => void;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {search && (
        <Badge variant="secondary" className="gap-1">
          Search: {search}
          <button type="button" onClick={onClearSearch} className="ml-0.5">
            <X className="h-3 w-3" />
          </button>
        </Badge>
      )}
      {kindFilter !== "all" && (
        <Badge variant="secondary" className="gap-1">
          Kind: {KIND_LABELS[kindFilter]}
          <button type="button" onClick={onClearKind} className="ml-0.5">
            <X className="h-3 w-3" />
          </button>
        </Badge>
      )}
      {statusFilter !== "all" && (
        <Badge variant="secondary" className="gap-1">
          Status: {statusFilter}
          <button type="button" onClick={onClearStatus} className="ml-0.5">
            <X className="h-3 w-3" />
          </button>
        </Badge>
      )}
      <button
        type="button"
        onClick={onClearAll}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        Clear all
      </button>
    </div>
  );
}

function AgentsTable({
  isPending,
  agents,
  totalCount,
}: {
  isPending: boolean;
  agents: Agent[];
  totalCount: number;
}): React.ReactElement {
  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Agent Name</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last Used</TableHead>
            <TableHead>Created</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            <TableRowsSkeleton columns={6} rows={6} action />
          ) : agents.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                <div className="space-y-2">
                  <div className="font-medium text-foreground">
                    {totalCount === 0 ? "No agents yet" : "No agents match your filters"}
                  </div>
                  <div>
                    {totalCount === 0
                      ? "Register your first agent to get started."
                      : "Try adjusting your search or filters."}
                  </div>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            agents.map((agent: Agent) => (
              <TableRow key={agent.id} className="cursor-pointer">
                <TableCell className="font-medium">
                  <Link href={`/agents/${agent.id}`}>{agent.name}</Link>
                </TableCell>
                <TableCell>
                  <KindBadge kind={agent.kind} />
                </TableCell>
                <TableCell>
                  <StatusBadge agent={agent} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                  {agent.lastUsedAt ? formatRelativeTime(agent.lastUsedAt) : "Never"}
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                  {formatRelativeTime(agent.createdAt)}
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    href={`/agents/${agent.id}`}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    View
                  </Link>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

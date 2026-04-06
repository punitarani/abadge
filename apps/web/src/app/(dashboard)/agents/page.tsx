"use client";

import type { Agent, AgentKind } from "@abadge/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SecretDisplay } from "@/components/ui/secret-display";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { formatRelativeTime } from "@/lib/utils";

const AGENT_KIND_LABELS: Record<AgentKind, string> = {
  device: "Device",
  local_cli: "Local CLI",
  local_mcp: "Local MCP",
  remote_agent: "Remote agent",
};

function AgentRow({
  agent,
  onRotate,
  onRevoke,
  mutating,
}: {
  agent: Agent;
  onRotate: (agentId: string) => void;
  onRevoke: (agentId: string) => void;
  mutating: boolean;
}): React.ReactElement {
  const isActive = agent.enabled && agent.revokedAt === null;

  return (
    <TableRow>
      <TableCell className="font-medium">{agent.name}</TableCell>
      <TableCell>
        <Badge variant="secondary">{AGENT_KIND_LABELS[agent.kind] ?? agent.kind}</Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">{agent.locality}</TableCell>
      <TableCell>
        {agent.keyPrefix ? (
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            {agent.keyPrefix}
          </code>
        ) : (
          <span className="text-muted-foreground">{"\u2014"}</span>
        )}
      </TableCell>
      <TableCell>
        <Badge variant={isActive ? "success" : "destructive"}>
          {isActive ? "Active" : "Revoked"}
        </Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {agent.lastUsedAt ? formatRelativeTime(agent.lastUsedAt) : "Never"}
      </TableCell>
      <TableCell className="text-muted-foreground">{formatRelativeTime(agent.createdAt)}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          {isActive ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={mutating}
                onClick={() => onRotate(agent.id)}
              >
                Rotate key
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={mutating}
                onClick={() => onRevoke(agent.id)}
              >
                Revoke
              </Button>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">No actions</span>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

export default function AgentsPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [rotatedApiKey, setRotatedApiKey] = useState<string | null>(null);
  const agentsQuery = useQuery({
    queryKey: dashboardQueryKeys.agents(),
    queryFn: () => browserTrpcClient.agents.list.query(),
  });
  const rotateAgent = useMutation({
    mutationFn: ({ agentId }: { agentId: string }) =>
      browserTrpcClient.agents.rotate.mutate({ agentId }),
    onSuccess: async (result) => {
      setRotatedApiKey(result.apiKey);
      await queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.agents(),
      });
    },
  });
  const revokeAgent = useMutation({
    mutationFn: ({ agentId }: { agentId: string }) =>
      browserTrpcClient.agents.revoke.mutate({ agentId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.agents(),
      });
    },
  });

  const agents = agentsQuery.data?.agents ?? [];

  async function handleRotate(agentId: string): Promise<void> {
    await rotateAgent.mutateAsync({ agentId });
  }

  async function handleRevoke(agentId: string): Promise<void> {
    if (!confirm("Revoke this agent? Existing permissions will no longer work.")) {
      return;
    }

    await revokeAgent.mutateAsync({ agentId });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Agents</h1>
          <p className="text-sm text-muted-foreground">
            Agents and services that can access your vault
          </p>
        </div>
        <Button size="sm" asChild>
          <Link href="/agents/new">Register agent</Link>
        </Button>
      </div>

      {rotatedApiKey ? (
        <div className="space-y-3 rounded-lg border border-border p-5">
          <div>
            <h2 className="text-sm font-semibold">Rotated API key</h2>
            <p className="text-sm text-muted-foreground">
              Save this key now. It will not be shown again.
            </p>
          </div>
          <SecretDisplay value={rotatedApiKey} />
          <Button variant="outline" size="sm" onClick={() => setRotatedApiKey(null)}>
            Dismiss
          </Button>
        </div>
      ) : null}

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Locality</TableHead>
              <TableHead>Key prefix</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agentsQuery.error ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-red-700">
                  {getClientErrorMessage(agentsQuery.error, "Failed to load agents")}
                </TableCell>
              </TableRow>
            ) : agentsQuery.isPending ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : agents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                  <div className="space-y-2">
                    <div className="font-medium text-foreground">No agents registered</div>
                    <div>
                      <Link href="/agents/new" className="text-link hover:underline">
                        Register your first agent
                      </Link>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              agents.map((agent: Agent) => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  onRotate={handleRotate}
                  onRevoke={handleRevoke}
                  mutating={rotateAgent.isPending || revokeAgent.isPending}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

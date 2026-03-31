"use client";

import { clientEnv } from "@abadge/env/client";
import Link from "next/link";
import React, { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRelativeTime } from "@/lib/utils";

interface Agent {
  id: string;
  name: string | null;
  prefix: string | null;
  start: string | null;
  enabled: boolean | null;
  lastRequest: string | null;
  metadata: string | null;
  createdAt: string;
}

function getDescription(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata);
    return parsed.description ?? null;
  } catch {
    return null;
  }
}

const COLUMN_COUNT = 7;

function AgentRow({
  agent,
  expanded,
  onToggleExpand,
  onToggleActive,
  onDelete,
  apiUrl,
}: {
  agent: Agent;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
  apiUrl: string;
}): React.JSX.Element {
  const description = getDescription(agent.metadata);
  return (
    <React.Fragment>
      <TableRow>
        <TableCell>
          <div>
            <div className="font-medium">{agent.name ?? "Unnamed"}</div>
            {description && (
              <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
            )}
          </div>
        </TableCell>
        <TableCell>
          <code className="text-xs bg-neutral-100 px-1.5 py-0.5 rounded font-mono">
            {agent.start ?? agent.prefix ?? "..."}
          </code>
        </TableCell>
        <TableCell>
          <Badge variant={agent.enabled ? "success" : "destructive"}>
            {agent.enabled ? "Active" : "Inactive"}
          </Badge>
        </TableCell>
        <TableCell className="text-muted-foreground">{"\u2014"}</TableCell>
        <TableCell className="text-muted-foreground">
          {agent.lastRequest ? formatRelativeTime(agent.lastRequest) : "Never"}
        </TableCell>
        <TableCell className="text-muted-foreground">
          {formatRelativeTime(agent.createdAt)}
        </TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onToggleExpand}>
              Session info
            </Button>
            <Button variant="ghost" size="sm" onClick={onToggleActive}>
              {agent.enabled ? "Disable" : "Enable"}
            </Button>
            <Button variant="destructive" size="sm" onClick={onDelete}>
              Delete
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={COLUMN_COUNT}>
            <div className="rounded-md border border-border bg-neutral-50 p-4 space-y-2 text-sm">
              <div className="font-medium text-foreground">Create a broker session</div>
              <p className="text-muted-foreground">
                Session creation requires agent authentication. Use the CLI or API directly:
              </p>
              <pre className="bg-white border border-border rounded-md p-3 text-xs font-mono overflow-x-auto whitespace-pre">
                {`# Via CLI
abadge run --secret <credential> -- <command>

# Via API
curl -X POST ${apiUrl}/v1/sessions \\
  -H "Authorization: Bearer <agent-api-key>" \\
  -H "Content-Type: application/json" \\
  -d '{"ttl": 3600}'`}
              </pre>
            </div>
          </TableCell>
        </TableRow>
      )}
    </React.Fragment>
  );
}

export default function AgentsPage(): React.JSX.Element {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const apiUrl = clientEnv.NEXT_PUBLIC_API_URL;

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/v1/agents`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setAgents(data.agents);
      }
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  async function handleToggleActive(agent: Agent): Promise<void> {
    await fetch(`${apiUrl}/v1/agents/${agent.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ enabled: !agent.enabled }),
    });
    fetchAgents();
  }

  async function handleDelete(id: string): Promise<void> {
    if (!confirm("Delete this agent? All permissions will be revoked.")) return;
    await fetch(`${apiUrl}/v1/agents/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    fetchAgents();
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Agents</h1>
          <p className="text-sm text-muted-foreground">Registered agents and their API keys</p>
        </div>
        <Button size="sm" asChild>
          <Link href="/agents/new">Register agent</Link>
        </Button>
      </div>

      <div className="border border-border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Key prefix</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sessions</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={COLUMN_COUNT}
                  className="text-center py-8 text-muted-foreground"
                >
                  Loading...
                </TableCell>
              </TableRow>
            ) : agents.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={COLUMN_COUNT}
                  className="text-center py-12 text-muted-foreground"
                >
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
              agents.map((agent) => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  expanded={expandedAgent === agent.id}
                  onToggleExpand={() =>
                    setExpandedAgent(expandedAgent === agent.id ? null : agent.id)
                  }
                  onToggleActive={() => handleToggleActive(agent)}
                  onDelete={() => handleDelete(agent.id)}
                  apiUrl={apiUrl}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

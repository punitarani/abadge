"use client";

import { clientEnv } from "@abadge/env/client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  const apiUrl = clientEnv.NEXT_PUBLIC_API_URL;

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/agents`, { credentials: "include" });
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

  async function handleToggleActive(agent: Agent) {
    await fetch(`${apiUrl}/api/agents/${agent.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ enabled: !agent.enabled }),
    });
    fetchAgents();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this agent? All permissions will be revoked.")) return;
    await fetch(`${apiUrl}/api/agents/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    fetchAgents();
  }

  return (
    <div className="space-y-6 max-w-4xl">
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
              <TableHead>Last used</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : agents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
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
                <TableRow key={agent.id}>
                  <TableCell>
                    <div>
                      <div className="font-medium">{agent.name ?? "Unnamed"}</div>
                      {getDescription(agent.metadata) && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {getDescription(agent.metadata)}
                        </div>
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
                  <TableCell className="text-muted-foreground">
                    {agent.lastRequest ? formatRelativeTime(agent.lastRequest) : "Never"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatRelativeTime(agent.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => handleToggleActive(agent)}>
                        {agent.enabled ? "Disable" : "Enable"}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(agent.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

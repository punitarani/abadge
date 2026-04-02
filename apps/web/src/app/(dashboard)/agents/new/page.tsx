"use client";

import { AGENT_KINDS, type AgentKind } from "@abadge/core";
import { useTRPC } from "@abadge/trpc/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SecretDisplay } from "@/components/ui/secret-display";
import { Textarea } from "@/components/ui/textarea";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { getClientErrorMessage } from "@/lib/trpc-browser";

const KIND_LABELS: Record<AgentKind, string> = {
  device: "Device",
  local_cli: "Local CLI",
  local_mcp: "Local MCP",
  remote_agent: "Remote Agent",
};

export default function NewAgentPage(): React.ReactElement {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AgentKind>("remote_agent");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [apiKey, setApiKey] = useState<string | null>(null);
  const createAgent = useMutation(
    trpc.agents.create.mutationOptions({
      onSuccess: async (result) => {
        setApiKey(result.apiKey);
        await queryClient.invalidateQueries({
          queryKey: dashboardQueryKeys.agents(),
        });
      },
    }),
  );

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await createAgent.mutateAsync({
        name,
        kind,
        metadata: description.trim() ? { description: description.trim() } : {},
      });
    } catch (mutationError) {
      setError(getClientErrorMessage(mutationError, "Failed to register agent"));
    } finally {
      setLoading(false);
    }
  }

  if (apiKey) {
    return (
      <div className="max-w-lg space-y-6">
        <div>
          <h1 className="text-lg font-semibold">Agent registered</h1>
          <p className="text-sm text-muted-foreground">
            Copy the API key below. It will not be shown again.
          </p>
        </div>

        <div className="space-y-4 rounded-lg border border-border p-5">
          <SecretDisplay value={apiKey} />

          <Button onClick={() => router.push("/agents")} className="w-full" size="sm">
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Register agent</h1>
        <p className="text-sm text-muted-foreground">
          Create a new agent or service identity and get an API key
        </p>
      </div>

      <div className="rounded-lg border border-border p-5">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="agent-name">Name</Label>
            <Input
              id="agent-name"
              placeholder="e.g., Claude Code, Cursor, CI Pipeline"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={64}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Kind</Label>
            <div className="flex flex-wrap gap-3">
              {AGENT_KINDS.map((agentKind) => (
                <label key={agentKind} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    name="kind"
                    value={agentKind}
                    checked={kind === agentKind}
                    onChange={() => setKind(agentKind)}
                  />
                  {KIND_LABELS[agentKind]}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agent-desc">Description (optional)</Label>
            <Textarea
              id="agent-desc"
              placeholder="What this agent does..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={256}
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => router.push("/agents")}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={loading}>
              {loading ? "Registering..." : "Register agent"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

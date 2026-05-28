"use client";

import { AGENT_KINDS, type AgentKind } from "@abadge/core";
import { useTRPC } from "@abadge/trpc/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { OneTimeSecretDisplay } from "@/components/dashboard/one-time-secret-display";
import { ResponsiveOverlay } from "@/components/dashboard/responsive-overlay";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { getClientErrorMessage } from "@/lib/trpc-browser";
import { cn } from "@/lib/utils";
import { useOrgStore } from "@/stores/org-store";

const KIND_CONFIG: Record<AgentKind, { label: string; description: string }> = {
  local_cli: { label: "Local CLI", description: "Developer machine" },
  local_mcp: { label: "Local MCP", description: "AI agent (MCP)" },
  remote: { label: "Remote", description: "Backend service" },
};

interface AgentRegistrationState {
  bootstrapToken: string | null;
  bootstrapExpiresAt: string | null;
}

interface CreateAgentPanelProps {
  open: boolean;
  onClose: () => void;
}

export function CreateAgentPanel({ open, onClose }: CreateAgentPanelProps): React.ReactElement {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { activeOrgId } = useOrgStore();
  const formId = useId();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AgentKind>("local_cli");
  const [description, setDescription] = useState("");
  const [issueBootstrap, setIssueBootstrap] = useState(true);
  const [loading, setLoading] = useState(false);
  const [registration, setRegistration] = useState<AgentRegistrationState | null>(null);

  const createAgent = useMutation(
    trpc.agents.create.mutationOptions({
      onSuccess: async (result) => {
        setRegistration({
          bootstrapToken: result.bootstrapToken,
          bootstrapExpiresAt: result.bootstrapExpiresAt,
        });
        await queryClient.invalidateQueries({
          queryKey: dashboardQueryKeys.orgAgents(activeOrgId ?? ""),
        });
        toast.success("Agent registered.");
      },
    }),
  );

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setLoading(true);

    try {
      await createAgent.mutateAsync({
        name,
        kind,
        issueBootstrapToken: issueBootstrap,
        metadata: description.trim() ? { description: description.trim() } : {},
      });
    } catch (mutationError) {
      toast.error(getClientErrorMessage(mutationError, "Failed to register agent"));
    } finally {
      setLoading(false);
    }
  }

  function handleClose(): void {
    onClose();
    // Reset form after close animation
    setTimeout(() => {
      setName("");
      setKind("local_cli");
      setDescription("");
      setIssueBootstrap(true);
      setRegistration(null);
    }, 300);
  }

  const inSuccessState = registration !== null;
  const title = inSuccessState ? "Agent registered" : "Register agent";
  const descriptionText = inSuccessState
    ? "Save the one-time credential before leaving this panel."
    : "Create a new agent or service identity.";

  const footer = inSuccessState ? (
    <div className="flex justify-end">
      <Button size="sm" onClick={handleClose}>
        Done
      </Button>
    </div>
  ) : (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" size="sm" onClick={handleClose}>
        Cancel
      </Button>
      <Button form={formId} type="submit" size="sm" disabled={loading}>
        {loading ? "Registering..." : "Register agent →"}
      </Button>
    </div>
  );

  const content = inSuccessState ? (
    <div className="flex flex-col gap-4">
      {registration.bootstrapToken ? (
        <OneTimeSecretDisplay
          value={registration.bootstrapToken}
          type="bootstrap_token"
          expiresAt={registration.bootstrapExpiresAt ?? undefined}
          onDismiss={handleClose}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Agent registered with public key session auth. Use the SDK to enroll its keypair.
        </p>
      )}
    </div>
  ) : (
    <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-5">
      {/* Name */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="agent-name">Name</Label>
        <Input
          id="agent-name"
          placeholder="e.g., claude-code, cursor-dev, ci-pipeline"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={64}
        />
        <p className="text-xs text-muted-foreground">Use kebab-case for consistency.</p>
      </div>

      {/* Description */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="agent-desc">Description (optional)</Label>
        <Textarea
          id="agent-desc"
          placeholder="What this agent does..."
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={256}
        />
      </div>

      {/* Agent type cards */}
      <fieldset className="flex flex-col gap-2">
        <div className="text-sm font-medium">Agent type</div>
        <div className="grid gap-2 sm:grid-cols-3">
          {AGENT_KINDS.map((agentKind) => {
            const config = KIND_CONFIG[agentKind];
            const selected = kind === agentKind;
            return (
              <button
                key={agentKind}
                type="button"
                onClick={() => setKind(agentKind)}
                className={cn(
                  "flex flex-col items-start rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                  selected
                    ? "border-foreground bg-accent"
                    : "border-border hover:border-muted-foreground/50",
                )}
              >
                <span className="font-medium">{config.label}</span>
                <span className="text-xs text-muted-foreground">{config.description}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Auth: agents use Ed25519 keypair sessions. Optionally issue a one-time
          enrollment token now; otherwise enroll the keypair later via the SDK. */}
      <div className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5">
        <input
          type="checkbox"
          id="issue-bootstrap"
          checked={issueBootstrap}
          onChange={(e) => setIssueBootstrap(e.target.checked)}
          className="mt-0.5"
        />
        <label htmlFor="issue-bootstrap" className="flex flex-col text-sm">
          <span className="font-medium">Issue bootstrap token</span>
          <span className="text-xs text-muted-foreground">
            Generates a one-time enrollment token (abe_...). Expires in 10 minutes.
          </span>
        </label>
      </div>
    </form>
  );

  return (
    <ResponsiveOverlay
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          handleClose();
        }
      }}
      title={title}
      description={descriptionText}
      footer={footer}
    >
      {content}
    </ResponsiveOverlay>
  );
}

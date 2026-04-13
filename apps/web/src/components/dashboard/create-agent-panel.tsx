"use client";

import { AGENT_KINDS, type AgentKind, type PrincipalAuthMethod } from "@abadge/core";
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

const AUTH_CONFIG: Record<
  PrincipalAuthMethod,
  { label: string; description: string; recommended?: boolean }
> = {
  public_key_session: {
    label: "Ed25519 keypair session",
    description:
      "Recommended. Short-lived tokens (15 min) auto-refreshed at T-2 min. No long-lived secret on disk.",
    recommended: true,
  },
  legacy_api_key: {
    label: "Legacy API key",
    description: "Static secret. SHA-256 hashed at rest. Shown once at creation.",
  },
};

interface AgentRegistrationState {
  apiKey: string | null;
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
  const [authMethod, setAuthMethod] = useState<PrincipalAuthMethod>("public_key_session");
  const [issueBootstrap, setIssueBootstrap] = useState(true);
  const [loading, setLoading] = useState(false);
  const [registration, setRegistration] = useState<AgentRegistrationState | null>(null);

  const createAgent = useMutation(
    trpc.agents.create.mutationOptions({
      onSuccess: async (result) => {
        setRegistration({
          apiKey: result.apiKey,
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
        authMethod,
        ...(authMethod === "public_key_session" ? { issueBootstrapToken: issueBootstrap } : {}),
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
      setAuthMethod("public_key_session");
      setIssueBootstrap(true);
      setRegistration(null);
    }, 300);
  }

  const inSuccessState = registration !== null;
  const title = inSuccessState ? "Agent registered" : "Register agent";
  const descriptionText = inSuccessState
    ? "Save the one-time credential before leaving this panel."
    : "Create a new agent or service identity.";

  const secretValue = registration?.bootstrapToken ?? registration?.apiKey ?? null;
  const secretType: "bootstrap_token" | "api_key" = registration?.bootstrapToken
    ? "bootstrap_token"
    : "api_key";

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
        {loading ? "Registering..." : "Register agent \u2192"}
      </Button>
    </div>
  );

  const content = inSuccessState ? (
    <div className="flex flex-col gap-4">
      {secretValue ? (
        <OneTimeSecretDisplay
          value={secretValue}
          type={secretType}
          expiresAt={registration.bootstrapExpiresAt ?? undefined}
          onDismiss={handleClose}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Agent registered with public key session auth. Use the SDK to enroll.
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

      {/* Auth method */}
      <fieldset className="flex flex-col gap-2">
        <div className="text-sm font-medium">Auth method</div>
        <div className="flex flex-col gap-2">
          {(["public_key_session", "legacy_api_key"] as const).map((method) => {
            const config = AUTH_CONFIG[method];
            const selected = authMethod === method;
            return (
              <button
                key={method}
                type="button"
                onClick={() => setAuthMethod(method)}
                className={cn(
                  "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                  selected
                    ? "border-foreground bg-accent"
                    : "border-border hover:border-muted-foreground/50",
                )}
              >
                <div
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0 rounded-full border-2",
                    selected ? "border-foreground bg-foreground" : "border-muted-foreground/40",
                  )}
                >
                  {selected && (
                    <div className="flex h-full w-full items-center justify-center">
                      <div className="h-1.5 w-1.5 rounded-full bg-background" />
                    </div>
                  )}
                </div>
                <div className="flex flex-col">
                  <span className="font-medium">
                    {config.label}
                    {config.recommended && (
                      <span className="ml-1.5 text-xs font-normal text-emerald-600 dark:text-emerald-400">
                        Recommended
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">{config.description}</span>
                </div>
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Bootstrap token toggle */}
      {authMethod === "public_key_session" && (
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
      )}
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

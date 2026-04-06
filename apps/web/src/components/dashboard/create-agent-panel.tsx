"use client";

import { AGENT_KINDS, type AgentKind } from "@abadge/core";
import { useTRPC } from "@abadge/trpc/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { ResponsiveOverlay } from "@/components/dashboard/responsive-overlay";
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

export interface AgentRegistrationState {
  apiKey: string | null;
  bootstrapToken: string | null;
  bootstrapExpiresAt: string | null;
}

type CreateAgentPanelViewProps =
  | {
      mode: "form";
      formId: string;
      name: string;
      kind: AgentKind;
      description: string;
      onNameChange: (value: string) => void;
      onKindChange: (value: AgentKind) => void;
      onDescriptionChange: (value: string) => void;
      onSubmit: React.FormEventHandler<HTMLFormElement>;
    }
  | {
      mode: "success";
      registration: AgentRegistrationState;
    };

export function CreateAgentPanelView(props: CreateAgentPanelViewProps): React.ReactElement {
  if (props.mode === "success") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Copy the credential below. It will not be shown again.
        </p>
        <SecretDisplay
          value={props.registration.apiKey ?? props.registration.bootstrapToken ?? ""}
        />
        {props.registration.bootstrapToken ? (
          <p className="text-sm text-muted-foreground">
            This bootstrap token can be redeemed exactly once to enroll the agent keypair.
            {props.registration.bootstrapExpiresAt
              ? ` Expires at ${props.registration.bootstrapExpiresAt}.`
              : ""}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form id={props.formId} onSubmit={props.onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="agent-name">Name</Label>
        <Input
          id="agent-name"
          placeholder="e.g., Claude Code, Cursor, CI Pipeline"
          value={props.name}
          onChange={(event) => props.onNameChange(event.target.value)}
          required
          maxLength={64}
        />
      </div>
      <fieldset className="flex flex-col gap-3">
        <div className="text-sm font-medium">Kind</div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-4">
          {AGENT_KINDS.map((agentKind) => (
            <label key={agentKind} className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="kind"
                value={agentKind}
                checked={props.kind === agentKind}
                onChange={() => props.onKindChange(agentKind)}
              />
              {KIND_LABELS[agentKind]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="agent-desc">Description (optional)</Label>
        <Textarea
          id="agent-desc"
          placeholder="What this agent does..."
          value={props.description}
          onChange={(event) => props.onDescriptionChange(event.target.value)}
          maxLength={256}
        />
      </div>
    </form>
  );
}

interface CreateAgentPanelProps {
  open: boolean;
  onClose: () => void;
}

export function CreateAgentPanel({ open, onClose }: CreateAgentPanelProps): React.ReactElement {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const formId = useId();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AgentKind>("remote_agent");
  const [description, setDescription] = useState("");
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
          queryKey: dashboardQueryKeys.agents(),
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
        metadata: description.trim() ? { description: description.trim() } : {},
      });
    } catch (mutationError) {
      toast.error(getClientErrorMessage(mutationError, "Failed to register agent"));
    } finally {
      setLoading(false);
    }
  }

  const inSuccessState = registration !== null;
  const title = inSuccessState ? "Agent registered" : "Register agent";
  const descriptionText = inSuccessState
    ? "Save the one-time credential before leaving this panel."
    : "Create a new agent or service identity. Remote agents use one-time enrollment tokens by default.";

  const footer = inSuccessState ? (
    <div className="flex justify-end">
      <Button size="sm" onClick={onClose}>
        Done
      </Button>
    </div>
  ) : (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" size="sm" onClick={onClose}>
        Cancel
      </Button>
      <Button form={formId} type="submit" size="sm" disabled={loading}>
        {loading ? "Registering..." : "Register agent"}
      </Button>
    </div>
  );

  const content = inSuccessState ? (
    <CreateAgentPanelView mode="success" registration={registration} />
  ) : (
    <CreateAgentPanelView
      mode="form"
      formId={formId}
      name={name}
      kind={kind}
      description={description}
      onNameChange={setName}
      onKindChange={setKind}
      onDescriptionChange={setDescription}
      onSubmit={handleSubmit}
    />
  );

  return (
    <ResponsiveOverlay
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
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

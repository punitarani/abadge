"use client";

import {
  credentialTypes,
  deliveryModes,
  environments,
  ownerScopes,
  sensitivities,
} from "@abadge/core";
import { clientEnv } from "@abadge/env/client";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Textarea } from "@/components/ui/textarea";
import {
  buildCredentialBody,
  type CredentialFormState,
  deliveryModeLabels,
  environmentStyles,
  sensitivityVariants,
  typeLabels,
} from "@/lib/credential-ui";
import { formatRelativeTime } from "@/lib/utils";

interface Credential {
  id: string;
  name: string;
  type: string;
  environment: string | null;
  sensitivity: string | null;
  ownerScope: string | null;
  service: string | null;
  provider: string | null;
  project: string | null;
  tags: string[] | null;
  allowedDeliveryModes: string[] | null;
  allowedDestinations: string[] | null;
  policies: { id: string; name: string }[] | null;
  metadata: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
}

interface PermissionEntry {
  agentId: string;
  credentialId: string;
  grantedAt: string;
  grantedBy: string;
  agentName: string | null;
  agentEnabled: boolean | null;
}

interface AgentEntry {
  id: string;
  name: string | null;
  enabled: boolean | null;
}

export default function CredentialDetailPage(): React.ReactElement {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [credential, setCredential] = useState<Credential | null>(null);
  const [permissions, setPermissions] = useState<PermissionEntry[]>([]);
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<CredentialFormState>({
    name: "",
    type: "",
    value: "",
    ownerScope: "user",
    environment: "",
    service: "",
    provider: "",
    project: "",
    sensitivity: "medium",
    allowedDeliveryModes: [],
    allowedDestinations: "",
    tags: "",
    metadata: "",
  });
  const [selectedAgent, setSelectedAgent] = useState("");
  const [saving, setSaving] = useState(false);
  const [granting, setGranting] = useState(false);
  const [error, setError] = useState("");

  const apiUrl = clientEnv.NEXT_PUBLIC_API_URL;

  const fetchData = useCallback(async () => {
    const [credRes, permRes, agentsRes] = await Promise.all([
      fetch(`${apiUrl}/v1/credentials/${id}`, { credentials: "include" }),
      fetch(`${apiUrl}/v1/permissions/credential/${id}`, { credentials: "include" }),
      fetch(`${apiUrl}/v1/agents`, { credentials: "include" }),
    ]);

    if (credRes.ok) {
      const data = await credRes.json();
      const cred = data.credential as Credential;
      setCredential(cred);
      setForm({
        name: cred.name,
        type: cred.type,
        value: "",
        ownerScope: cred.ownerScope ?? "user",
        environment: cred.environment ?? "",
        service: cred.service ?? "",
        provider: cred.provider ?? "",
        project: cred.project ?? "",
        sensitivity: cred.sensitivity ?? "medium",
        allowedDeliveryModes: cred.allowedDeliveryModes ?? [...deliveryModes],
        allowedDestinations: cred.allowedDestinations?.join(", ") ?? "",
        tags: cred.tags?.join(", ") ?? "",
        metadata: cred.metadata ? JSON.stringify(cred.metadata) : "",
      });
    }
    if (permRes.ok) {
      const data = await permRes.json();
      setPermissions(data.permissions);
    }
    if (agentsRes.ok) {
      const data = await agentsRes.json();
      setAgents(data.agents);
    }
  }, [apiUrl, id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function toggleDeliveryMode(mode: string): void {
    setForm((prev) => ({
      ...prev,
      allowedDeliveryModes: prev.allowedDeliveryModes.includes(mode)
        ? prev.allowedDeliveryModes.filter((m) => m !== mode)
        : [...prev.allowedDeliveryModes, mode],
    }));
  }

  async function handleUpdate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = buildCredentialBody(form, credential);
      if (!result.ok) {
        setError(result.error);
        setSaving(false);
        return;
      }

      const res = await fetch(`${apiUrl}/v1/credentials/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(result.body),
      });
      if (res.ok) {
        setEditing(false);
        fetchData();
      } else {
        setError("Failed to update credential");
      }
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setSaving(false);
    }
  }

  async function handleGrant(): Promise<void> {
    if (!selectedAgent) return;
    setGranting(true);
    try {
      await fetch(`${apiUrl}/v1/permissions/grant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ agentId: selectedAgent, credentialId: id }),
      });
      setSelectedAgent("");
      fetchData();
    } finally {
      setGranting(false);
    }
  }

  async function handleRevoke(agentId: string): Promise<void> {
    await fetch(`${apiUrl}/v1/permissions/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ agentId, credentialId: id }),
    });
    fetchData();
  }

  if (!credential) {
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  }

  const permittedAgentIds = new Set(permissions.map((p) => p.agentId));
  const availableAgents = agents.filter((a) => !permittedAgentIds.has(a.id) && a.enabled);

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{credential.name}</h1>
            <Badge variant="secondary">{typeLabels[credential.type] ?? credential.type}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Created {formatRelativeTime(credential.createdAt)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => router.push("/credentials")}>
            Back
          </Button>
          <Button size="sm" onClick={() => setEditing(!editing)}>
            {editing ? "Cancel" : "Edit"}
          </Button>
        </div>
      </div>

      <div className="border border-border rounded-lg p-5 space-y-4">
        <div className="text-sm font-semibold">Details</div>

        <div className="flex flex-wrap gap-2">
          {credential.environment && (
            <Badge variant="outline" className={environmentStyles[credential.environment] ?? ""}>
              {credential.environment}
            </Badge>
          )}
          {credential.sensitivity && (
            <Badge variant={sensitivityVariants[credential.sensitivity]?.variant ?? "default"}>
              {credential.sensitivity}
            </Badge>
          )}
          {credential.ownerScope && <Badge variant="outline">{credential.ownerScope}</Badge>}
        </div>

        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Service</div>
            <div className="font-medium">{credential.service ?? "\u2014"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Provider</div>
            <div className="font-medium">{credential.provider ?? "\u2014"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Project</div>
            <div className="font-medium">{credential.project ?? "\u2014"}</div>
          </div>
        </div>

        {credential.tags && credential.tags.length > 0 && (
          <div>
            <div className="text-sm text-muted-foreground mb-1">Tags</div>
            <div className="flex flex-wrap gap-1">
              {credential.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {credential.allowedDeliveryModes && credential.allowedDeliveryModes.length > 0 && (
          <div>
            <div className="text-sm text-muted-foreground mb-1">Allowed delivery modes</div>
            <div className="flex flex-wrap gap-1">
              {credential.allowedDeliveryModes.map((mode) => (
                <Badge key={mode} variant="outline" className="text-xs">
                  {deliveryModeLabels[mode] ?? mode}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {credential.allowedDestinations && credential.allowedDestinations.length > 0 && (
          <div>
            <div className="text-sm text-muted-foreground mb-1">Allowed destinations</div>
            <div className="flex flex-wrap gap-1">
              {credential.allowedDestinations.map((dest) => (
                <Badge key={dest} variant="outline" className="text-xs">
                  {dest}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>

      {credential.policies && credential.policies.length > 0 && (
        <div className="border border-border rounded-lg p-5 space-y-3">
          <div className="text-sm font-semibold">Policies</div>
          <div className="flex flex-wrap gap-1">
            {credential.policies.map((policy) => (
              <Badge key={policy.id} variant="outline">
                {policy.name}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Manage policies in the Policies page</p>
        </div>
      )}

      {editing && (
        <div className="border border-border rounded-lg p-5">
          <div className="text-sm font-semibold mb-4">Edit credential</div>
          <form onSubmit={handleUpdate} className="space-y-4">
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit-name">Name</Label>
                <Input
                  id="edit-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-type">Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger id="edit-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {credentialTypes.map((t) => (
                      <SelectItem key={t} value={t}>
                        {typeLabels[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-value">New value (leave blank to keep current)</Label>
              <Textarea
                id="edit-value"
                placeholder="Enter new secret value..."
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit-owner-scope">Owner scope</Label>
                <Select
                  value={form.ownerScope}
                  onValueChange={(v) => setForm({ ...form, ownerScope: v })}
                >
                  <SelectTrigger id="edit-owner-scope">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ownerScopes.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-environment">Environment</Label>
                <Select
                  value={form.environment}
                  onValueChange={(v) => setForm({ ...form, environment: v })}
                >
                  <SelectTrigger id="edit-environment">
                    <SelectValue placeholder="Optional" />
                  </SelectTrigger>
                  <SelectContent>
                    {environments.map((env) => (
                      <SelectItem key={env} value={env}>
                        {env}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-sensitivity">Sensitivity</Label>
                <Select
                  value={form.sensitivity}
                  onValueChange={(v) => setForm({ ...form, sensitivity: v })}
                >
                  <SelectTrigger id="edit-sensitivity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sensitivities.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit-service">Service</Label>
                <Input
                  id="edit-service"
                  placeholder="e.g., github, aws, stripe"
                  value={form.service}
                  onChange={(e) => setForm({ ...form, service: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-provider">Provider</Label>
                <Input
                  id="edit-provider"
                  placeholder="Optional"
                  value={form.provider}
                  onChange={(e) => setForm({ ...form, provider: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-project">Project</Label>
                <Input
                  id="edit-project"
                  placeholder="Optional"
                  value={form.project}
                  onChange={(e) => setForm({ ...form, project: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Allowed delivery modes</Label>
              <div className="flex flex-wrap gap-3">
                {deliveryModes.map((mode) => (
                  <label key={mode} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={form.allowedDeliveryModes.includes(mode)}
                      onChange={() => toggleDeliveryMode(mode)}
                      className="rounded border-input"
                    />
                    {deliveryModeLabels[mode]}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-destinations">Allowed destinations (comma-separated)</Label>
              <Input
                id="edit-destinations"
                placeholder="Optional"
                value={form.allowedDestinations}
                onChange={(e) => setForm({ ...form, allowedDestinations: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-tags">Tags (comma-separated)</Label>
              <Input
                id="edit-tags"
                placeholder="e.g., production, deploy, ci"
                value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-metadata">Metadata (JSON)</Label>
              <Textarea
                id="edit-metadata"
                value={form.metadata}
                onChange={(e) => setForm({ ...form, metadata: e.target.value })}
                className="min-h-[60px]"
              />
            </div>

            <Button type="submit" size="sm" disabled={saving}>
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </form>
        </div>
      )}

      <div className="border border-border rounded-lg">
        <div className="px-5 py-4 border-b border-border">
          <div className="text-sm font-semibold">Access permissions</div>
          <div className="text-sm text-muted-foreground">Agents that can read this credential</div>
        </div>

        {availableAgents.length > 0 && (
          <div className="px-5 py-3 border-b border-border flex gap-2">
            <div className="flex-1">
              <Select value={selectedAgent} onValueChange={setSelectedAgent}>
                <SelectTrigger aria-label="Select agent to grant access">
                  <SelectValue placeholder="Select an agent to grant access..." />
                </SelectTrigger>
                <SelectContent>
                  {availableAgents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name ?? "Unnamed"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={handleGrant} disabled={!selectedAgent || granting}>
              {granting ? "Granting..." : "Grant access"}
            </Button>
          </div>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Granted</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {permissions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                  No agents have access to this credential
                </TableCell>
              </TableRow>
            ) : (
              permissions.map((perm) => (
                <TableRow key={perm.agentId}>
                  <TableCell className="font-medium">{perm.agentName ?? "Unnamed"}</TableCell>
                  <TableCell>
                    <Badge variant={perm.agentEnabled ? "success" : "destructive"}>
                      {perm.agentEnabled ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatRelativeTime(perm.grantedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleRevoke(perm.agentId)}
                    >
                      Revoke
                    </Button>
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

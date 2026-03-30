"use client";

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
import { formatRelativeTime } from "@/lib/utils";

interface Credential {
  id: string;
  name: string;
  type: string;
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

const credentialTypes = ["api_key", "login", "token", "json_blob", "pii", "other"] as const;
const typeLabels: Record<string, string> = {
  api_key: "API Key",
  login: "Login",
  token: "Token",
  json_blob: "JSON",
  pii: "PII",
  other: "Other",
};

export default function CredentialDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [credential, setCredential] = useState<Credential | null>(null);
  const [permissions, setPermissions] = useState<PermissionEntry[]>([]);
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", type: "", value: "", metadata: "" });
  const [selectedAgent, setSelectedAgent] = useState("");
  const [saving, setSaving] = useState(false);
  const [granting, setGranting] = useState(false);
  const [error, setError] = useState("");

  const apiUrl = clientEnv.NEXT_PUBLIC_API_URL;

  const fetchData = useCallback(async () => {
    const [credRes, permRes, agentsRes] = await Promise.all([
      fetch(`${apiUrl}/api/credentials/${id}`, { credentials: "include" }),
      fetch(`${apiUrl}/api/permissions/credential/${id}`, { credentials: "include" }),
      fetch(`${apiUrl}/api/agents`, { credentials: "include" }),
    ]);

    if (credRes.ok) {
      const data = await credRes.json();
      setCredential(data.credential);
      setForm({
        name: data.credential.name,
        type: data.credential.type,
        value: "",
        metadata: data.credential.metadata ? JSON.stringify(data.credential.metadata) : "",
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

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const body: Record<string, unknown> = {};
      if (form.name !== credential?.name) body.name = form.name;
      if (form.type !== credential?.type) body.type = form.type;
      if (form.value) body.value = form.value;
      if (form.metadata.trim()) {
        try {
          body.metadata = JSON.parse(form.metadata);
        } catch {
          setError("Invalid JSON in metadata field");
          setSaving(false);
          return;
        }
      }

      const res = await fetch(`${apiUrl}/api/credentials/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
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

  async function handleGrant() {
    if (!selectedAgent) return;
    setGranting(true);
    try {
      await fetch(`${apiUrl}/api/permissions/grant`, {
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

  async function handleRevoke(agentId: string) {
    await fetch(`${apiUrl}/api/permissions/revoke`, {
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
            <div className="space-y-1.5">
              <Label htmlFor="edit-metadata">Metadata (JSON)</Label>
              <Input
                id="edit-metadata"
                value={form.metadata}
                onChange={(e) => setForm({ ...form, metadata: e.target.value })}
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

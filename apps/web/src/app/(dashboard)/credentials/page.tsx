"use client";

import { clientEnv } from "@abadge/env/client";
import Link from "next/link";
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

const credentialTypes = ["api_key", "login", "token", "json_blob", "pii", "other"] as const;
const typeLabels: Record<string, string> = {
  api_key: "API Key",
  login: "Login",
  token: "Token",
  json_blob: "JSON",
  pii: "PII",
  other: "Other",
};

export default function CredentialsPage() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    type: "api_key",
    value: "",
    metadata: "",
  });

  const apiUrl = clientEnv.NEXT_PUBLIC_API_URL;

  const fetchCredentials = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/credentials`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setCredentials(data.credentials);
      }
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    fetchCredentials();
  }, [fetchCredentials]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError("");
    try {
      let metadata: Record<string, string> | undefined;
      if (form.metadata.trim()) {
        try {
          metadata = JSON.parse(form.metadata);
        } catch {
          setError("Invalid JSON in metadata field");
          setCreating(false);
          return;
        }
      }
      const res = await fetch(`${apiUrl}/api/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: form.name, type: form.type, value: form.value, metadata }),
      });
      if (res.ok) {
        setShowCreate(false);
        setForm({ name: "", type: "api_key", value: "", metadata: "" });
        fetchCredentials();
      } else {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "Failed to create credential");
      }
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this credential? This cannot be undone.")) return;
    const res = await fetch(`${apiUrl}/api/credentials/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) {
      fetchCredentials();
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Credentials</h1>
          <p className="text-sm text-muted-foreground">Encrypted secrets stored in your vault</p>
        </div>
        <Button onClick={() => setShowCreate(!showCreate)} size="sm">
          {showCreate ? "Cancel" : "Add credential"}
        </Button>
      </div>

      {showCreate && (
        <div className="border border-border rounded-lg p-5">
          <div className="text-sm font-semibold mb-4">New credential</div>
          <form onSubmit={handleCreate} className="space-y-4">
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="cred-name">Name</Label>
                <Input
                  id="cred-name"
                  placeholder="e.g., github-deploy-key"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cred-type">Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger id="cred-type">
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
              <Label htmlFor="cred-value">Value</Label>
              <Textarea
                id="cred-value"
                placeholder="The secret value — encrypted at rest"
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cred-metadata">Metadata (JSON, optional)</Label>
              <Input
                id="cred-metadata"
                placeholder='{"service": "github"}'
                value={form.metadata}
                onChange={(e) => setForm({ ...form, metadata: e.target.value })}
              />
            </div>
            <Button type="submit" size="sm" disabled={creating}>
              {creating ? "Creating..." : "Create"}
            </Button>
          </form>
        </div>
      )}

      <div className="border border-border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Metadata</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : credentials.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                  <div className="space-y-2">
                    <div className="font-medium text-foreground">No credentials yet</div>
                    <div>Add your first secret to get started.</div>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              credentials.map((cred) => (
                <TableRow key={cred.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/credentials/${cred.id}`}
                      className="text-foreground hover:underline"
                    >
                      {cred.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{typeLabels[cred.type] ?? cred.type}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {cred.metadata ? Object.keys(cred.metadata).join(", ") : "\u2014"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatRelativeTime(cred.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/credentials/${cred.id}`}>Manage</Link>
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => handleDelete(cred.id)}>
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

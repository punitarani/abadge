"use client";

import { PRINCIPAL_KINDS, type PrincipalKind } from "@abadge/core";
import { clientEnv } from "@abadge/env/client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SecretDisplay } from "@/components/ui/secret-display";
import { Textarea } from "@/components/ui/textarea";
import { extractApiError } from "@/lib/api-client";

const KIND_LABELS: Record<PrincipalKind, string> = {
  device: "Device",
  local_cli: "Local CLI",
  local_mcp: "Local MCP",
  remote_agent: "Remote Agent",
};

export default function NewPrincipalPage(): React.ReactElement {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<PrincipalKind>("remote_agent");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [apiKey, setApiKey] = useState<string | null>(null);

  const apiUrl = clientEnv.NEXT_PUBLIC_API_URL;

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiUrl}/v1/principals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name,
          kind,
          metadata: description.trim() ? { description: description.trim() } : {},
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setApiKey(data.secret);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(extractApiError(data, "Failed to register principal"));
      }
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }

  if (apiKey) {
    return (
      <div className="max-w-lg space-y-6">
        <div>
          <h1 className="text-lg font-semibold">Principal registered</h1>
          <p className="text-sm text-muted-foreground">
            Copy the API key below. It will not be shown again.
          </p>
        </div>

        <div className="border border-border rounded-lg p-5 space-y-4">
          <SecretDisplay value={apiKey} />

          <Button onClick={() => router.push("/principals")} className="w-full" size="sm">
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Register principal</h1>
        <p className="text-sm text-muted-foreground">
          Create a new agent or service identity and get an API key
        </p>
      </div>

      <div className="border border-border rounded-lg p-5">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="principal-name">Name</Label>
            <Input
              id="principal-name"
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
              {PRINCIPAL_KINDS.map((k) => (
                <label key={k} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    name="kind"
                    value={k}
                    checked={kind === k}
                    onChange={() => setKind(k)}
                  />
                  {KIND_LABELS[k]}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="principal-desc">Description (optional)</Label>
            <Textarea
              id="principal-desc"
              placeholder="What this principal does..."
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
              onClick={() => router.push("/principals")}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={loading}>
              {loading ? "Registering..." : "Register principal"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

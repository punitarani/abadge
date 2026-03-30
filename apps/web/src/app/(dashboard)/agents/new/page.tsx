"use client";

import { clientEnv } from "@abadge/env/client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { extractApiError } from "@/lib/api-client";

export default function NewAgentPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const apiUrl = clientEnv.NEXT_PUBLIC_API_URL;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiUrl}/v1/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, description: description || undefined }),
      });
      if (res.ok) {
        const data = await res.json();
        setApiKey(data.apiKey);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(extractApiError(data, "Failed to register agent"));
      }
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (apiKey) {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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

        <div className="border border-border rounded-lg p-5 space-y-4">
          <div className="bg-neutral-50 border border-border rounded-md p-3 flex items-start justify-between gap-3">
            <code className="text-sm font-mono break-all flex-1">{apiKey}</code>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              aria-label={copied ? "Copied to clipboard" : "Copy API key"}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>

          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            This key will not be shown again. Store it securely.
          </div>

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
          Create a new agent identity and get an API key
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
            <Label htmlFor="agent-name">Agent name</Label>
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

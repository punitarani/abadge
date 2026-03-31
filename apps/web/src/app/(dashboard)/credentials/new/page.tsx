"use client";

import {
  credentialTypes,
  deliveryModes,
  environments,
  ownerScopes,
  sensitivities,
} from "@abadge/core";
import { clientEnv } from "@abadge/env/client";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { extractApiError } from "@/lib/api-client";
import {
  buildCredentialBody,
  type CredentialFormState,
  deliveryModeLabels,
  typeLabels,
} from "@/lib/credential-ui";

const initialForm: CredentialFormState = {
  name: "",
  type: "api_key",
  value: "",
  ownerScope: "user",
  environment: "",
  service: "",
  provider: "",
  project: "",
  sensitivity: "medium",
  allowedDeliveryModes: [...deliveryModes],
  allowedDestinations: "",
  tags: "",
  metadata: "",
};

export default function CreateCredentialPage(): React.ReactElement {
  const router = useRouter();
  const [form, setForm] = useState<CredentialFormState>(initialForm);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const apiUrl = clientEnv.NEXT_PUBLIC_API_URL;

  function toggleDeliveryMode(mode: string): void {
    setForm((prev) => ({
      ...prev,
      allowedDeliveryModes: prev.allowedDeliveryModes.includes(mode)
        ? prev.allowedDeliveryModes.filter((m) => m !== mode)
        : [...prev.allowedDeliveryModes, mode],
    }));
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setCreating(true);
    setError("");

    try {
      const result = buildCredentialBody(form);
      if (!result.ok) {
        setError(result.error);
        setCreating(false);
        return;
      }

      const res = await fetch(`${apiUrl}/v1/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(result.body),
      });

      if (res.ok) {
        router.push("/credentials");
      } else {
        const data = await res.json().catch(() => ({}));
        setError(extractApiError(data, "Failed to create credential"));
      }
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-lg font-semibold">Create credential</h1>
        <p className="text-sm text-muted-foreground">Add an encrypted secret to your vault</p>
      </div>

      <div className="border border-border rounded-lg p-5">
        <form onSubmit={handleSubmit} className="space-y-5">
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
              placeholder="The secret value -- encrypted at rest"
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="cred-owner-scope">Owner scope</Label>
              <Select
                value={form.ownerScope}
                onValueChange={(v) => setForm({ ...form, ownerScope: v })}
              >
                <SelectTrigger id="cred-owner-scope">
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
              <Label htmlFor="cred-environment">Environment</Label>
              <Select
                value={form.environment}
                onValueChange={(v) => setForm({ ...form, environment: v })}
              >
                <SelectTrigger id="cred-environment">
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
              <Label htmlFor="cred-sensitivity">Sensitivity</Label>
              <Select
                value={form.sensitivity}
                onValueChange={(v) => setForm({ ...form, sensitivity: v })}
              >
                <SelectTrigger id="cred-sensitivity">
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
              <Label htmlFor="cred-service">Service</Label>
              <Input
                id="cred-service"
                placeholder="e.g., github, aws, stripe"
                value={form.service}
                onChange={(e) => setForm({ ...form, service: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cred-provider">Provider</Label>
              <Input
                id="cred-provider"
                placeholder="Optional"
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cred-project">Project</Label>
              <Input
                id="cred-project"
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
            <Label htmlFor="cred-destinations">Allowed destinations (comma-separated)</Label>
            <Input
              id="cred-destinations"
              placeholder="Optional"
              value={form.allowedDestinations}
              onChange={(e) => setForm({ ...form, allowedDestinations: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cred-tags">Tags (comma-separated)</Label>
            <Input
              id="cred-tags"
              placeholder="e.g., production, deploy, ci"
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cred-metadata">Metadata (JSON, optional)</Label>
            <Textarea
              id="cred-metadata"
              placeholder='{"key": "value"}'
              value={form.metadata}
              onChange={(e) => setForm({ ...form, metadata: e.target.value })}
              className="min-h-[60px]"
            />
          </div>

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={creating}>
              {creating ? "Creating..." : "Create"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => router.push("/credentials")}
            >
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

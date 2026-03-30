"use client";

import { clientEnv } from "@abadge/env/client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
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
import { extractApiError } from "@/lib/api-client";

interface Credential {
  id: string;
  name: string;
}

const ruleTypes = ["delivery_mode", "environment", "sensitivity", "destination"] as const;
type RuleType = (typeof ruleTypes)[number];

const ruleTypeLabels: Record<RuleType, string> = {
  delivery_mode: "Delivery Mode",
  environment: "Environment",
  sensitivity: "Sensitivity",
  destination: "Destination",
};

const deliveryModes = ["direct", "proxy", "ephemeral"] as const;
const environments = ["production", "staging", "development", "ci"] as const;
const sensitivityLevels = ["low", "medium", "high", "critical"] as const;

interface RuleForm {
  type: RuleType;
  allowedModes: string[];
  allowedEnvironments: string[];
  requiresApprovalAbove: string;
  allowedDestinations: string;
  blockedDestinations: string;
  maxTtlSeconds: string;
}

function emptyRule(): RuleForm {
  return {
    type: "delivery_mode",
    allowedModes: [],
    allowedEnvironments: [],
    requiresApprovalAbove: "",
    allowedDestinations: "",
    blockedDestinations: "",
    maxTtlSeconds: "",
  };
}

function buildRulePayload(rule: RuleForm): Record<string, unknown> {
  const base: Record<string, unknown> = { type: rule.type };
  switch (rule.type) {
    case "delivery_mode":
      base.allowedModes = rule.allowedModes;
      break;
    case "environment":
      base.allowedEnvironments = rule.allowedEnvironments;
      break;
    case "sensitivity":
      if (rule.requiresApprovalAbove) base.requiresApprovalAbove = rule.requiresApprovalAbove;
      break;
    case "destination":
      if (rule.allowedDestinations.trim()) {
        base.allowedDestinations = rule.allowedDestinations.split(",").map((s) => s.trim());
      }
      if (rule.blockedDestinations.trim()) {
        base.blockedDestinations = rule.blockedDestinations.split(",").map((s) => s.trim());
      }
      break;
  }
  if (rule.maxTtlSeconds) base.maxTtlSeconds = Number(rule.maxTtlSeconds);
  return base;
}

export default function NewPolicyPage(): React.ReactElement {
  const router = useRouter();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [name, setName] = useState("");
  const [credentialId, setCredentialId] = useState("global");
  const [rules, setRules] = useState<RuleForm[]>([emptyRule()]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const apiUrl = clientEnv.NEXT_PUBLIC_API_URL;

  const fetchCredentials = useCallback(async () => {
    const res = await fetch(`${apiUrl}/v1/credentials`, { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      setCredentials(data.credentials as Credential[]);
    }
  }, [apiUrl]);

  useEffect(() => {
    fetchCredentials();
  }, [fetchCredentials]);

  function updateRule(index: number, updates: Partial<RuleForm>): void {
    setRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...updates } : r)));
  }

  function toggleCheckbox(
    index: number,
    field: "allowedModes" | "allowedEnvironments",
    value: string,
  ): void {
    setRules((prev) =>
      prev.map((r, i) => {
        if (i !== index) return r;
        const current = r[field];
        const next = current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value];
        return { ...r, [field]: next };
      }),
    );
  }

  function addRule(): void {
    setRules((prev) => [...prev, emptyRule()]);
  }

  function removeRule(index: number): void {
    setRules((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleCreate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setCreating(true);
    setError("");
    try {
      const body = {
        name,
        credentialId: credentialId === "global" ? null : credentialId,
        rules: rules.map(buildRulePayload),
      };
      const res = await fetch(`${apiUrl}/v1/policies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (res.ok) {
        router.push("/policies");
      } else {
        const data = await res.json().catch(() => ({}));
        setError(extractApiError(data, "Failed to create policy"));
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
        <h1 className="text-lg font-semibold">Create policy</h1>
        <p className="text-sm text-muted-foreground">
          Define rules that govern how credentials can be accessed
        </p>
      </div>

      <div className="border border-border rounded-lg p-5">
        <form onSubmit={handleCreate} className="space-y-5">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="policy-name">Name</Label>
              <Input
                id="policy-name"
                placeholder="e.g., production-only"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="policy-credential">Credential</Label>
              <Select value={credentialId} onValueChange={setCredentialId}>
                <SelectTrigger id="policy-credential">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">Global (all credentials)</SelectItem>
                  {credentials.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Rules</Label>
              <Button type="button" variant="outline" size="sm" onClick={addRule}>
                Add rule
              </Button>
            </div>

            {rules.map((rule, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rules are reordered by index
              <div key={index} className="border border-border rounded-md p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Rule {index + 1}</Label>
                  {rules.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeRule(index)}
                    >
                      Remove
                    </Button>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`rule-type-${index}`}>Type</Label>
                  <Select
                    value={rule.type}
                    onValueChange={(v) => updateRule(index, { type: v as RuleType })}
                  >
                    <SelectTrigger id={`rule-type-${index}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ruleTypes.map((t) => (
                        <SelectItem key={t} value={t}>
                          {ruleTypeLabels[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {rule.type === "delivery_mode" && (
                  <div className="space-y-1.5">
                    <Label>Allowed modes</Label>
                    <div className="flex gap-3">
                      {deliveryModes.map((mode) => (
                        <label key={mode} className="flex items-center gap-1.5 text-sm">
                          <input
                            type="checkbox"
                            checked={rule.allowedModes.includes(mode)}
                            onChange={() => toggleCheckbox(index, "allowedModes", mode)}
                            className="rounded border-input"
                          />
                          {mode}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {rule.type === "environment" && (
                  <div className="space-y-1.5">
                    <Label>Allowed environments</Label>
                    <div className="flex gap-3">
                      {environments.map((env) => (
                        <label key={env} className="flex items-center gap-1.5 text-sm">
                          <input
                            type="checkbox"
                            checked={rule.allowedEnvironments.includes(env)}
                            onChange={() => toggleCheckbox(index, "allowedEnvironments", env)}
                            className="rounded border-input"
                          />
                          {env}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {rule.type === "sensitivity" && (
                  <div className="space-y-1.5">
                    <Label htmlFor={`rule-sensitivity-${index}`}>Requires approval above</Label>
                    <Select
                      value={rule.requiresApprovalAbove}
                      onValueChange={(v) => updateRule(index, { requiresApprovalAbove: v })}
                    >
                      <SelectTrigger id={`rule-sensitivity-${index}`}>
                        <SelectValue placeholder="Select threshold..." />
                      </SelectTrigger>
                      <SelectContent>
                        {sensitivityLevels.map((level) => (
                          <SelectItem key={level} value={level}>
                            {level}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {rule.type === "destination" && (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor={`rule-allowed-dest-${index}`}>
                        Allowed destinations (comma-separated)
                      </Label>
                      <Input
                        id={`rule-allowed-dest-${index}`}
                        placeholder="api.example.com, cdn.example.com"
                        value={rule.allowedDestinations}
                        onChange={(e) => updateRule(index, { allowedDestinations: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`rule-blocked-dest-${index}`}>
                        Blocked destinations (comma-separated)
                      </Label>
                      <Input
                        id={`rule-blocked-dest-${index}`}
                        placeholder="evil.example.com"
                        value={rule.blockedDestinations}
                        onChange={(e) => updateRule(index, { blockedDestinations: e.target.value })}
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor={`rule-ttl-${index}`}>Max TTL (seconds, optional)</Label>
                  <Input
                    id={`rule-ttl-${index}`}
                    type="number"
                    placeholder="3600"
                    value={rule.maxTtlSeconds}
                    onChange={(e) => updateRule(index, { maxTtlSeconds: e.target.value })}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={creating}>
              {creating ? "Creating..." : "Create policy"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => router.push("/policies")}
            >
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

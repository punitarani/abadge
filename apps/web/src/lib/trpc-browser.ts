"use client";

import { clientEnv } from "@abadge/env/client";
import { createBrowserTrpcClient, normalizeTrpcError } from "@abadge/trpc/client";

export const browserTrpcClient: ReturnType<typeof createBrowserTrpcClient> =
  createBrowserTrpcClient({
    baseUrl: clientEnv.ABADGE_API_URL,
  });

function formatIssue(issue: unknown): string | undefined {
  if (!issue || typeof issue !== "object") {
    return undefined;
  }

  const record = issue as Record<string, unknown>;
  const message = typeof record.message === "string" ? record.message : undefined;
  if (!message) {
    return undefined;
  }

  const path = Array.isArray(record.path)
    ? record.path.filter((segment): segment is string => typeof segment === "string").join(".")
    : "";

  return path ? `${path}: ${message}` : message;
}

export function getClientErrorMessage(error: unknown, fallback: string): string {
  const normalized = normalizeTrpcError(error);
  if (Array.isArray(normalized.issues) && normalized.issues.length > 0) {
    const issueMessage = formatIssue(normalized.issues[0]);
    if (issueMessage) {
      return issueMessage;
    }
  }

  return normalized.message || fallback;
}

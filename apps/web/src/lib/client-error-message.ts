import { normalizeTrpcError } from "@abadge/trpc/client";

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

function appendHint(message: string, hint: string | undefined): string {
  if (!hint) {
    return message;
  }
  // Avoid duplicating the hint if the server already folded it into the message.
  // Anchored to end-of-message so short hints ("Try again.") don't false-positive
  // when they appear as a substring mid-message.
  if (message.endsWith(hint)) {
    return message;
  }
  return `${message} — ${hint}`;
}

export function getClientErrorMessage(error: unknown, fallback: string): string {
  const normalized = normalizeTrpcError(error);
  if (Array.isArray(normalized.issues) && normalized.issues.length > 0) {
    const issueMessage = formatIssue(normalized.issues[0]);
    if (issueMessage) {
      return appendHint(issueMessage, normalized.hint);
    }
  }

  return appendHint(normalized.message || fallback, normalized.hint);
}

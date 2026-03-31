interface MatchableCredential {
  environment: string | null;
  tags: string[] | null;
  type: string;
  service: string | null;
  sensitivity: string | null;
}

interface MatchableAutoGrant {
  matchEnvironment: string | null;
  matchTags: string[] | null;
  matchType: string | null;
  matchService: string | null;
  matchSensitivity: string | null;
}

/** Returns true if the credential matches all non-null criteria in the auto-grant (conjunction). */
export function matchesAutoGrant(
  credential: MatchableCredential,
  autoGrant: MatchableAutoGrant,
): boolean {
  if (autoGrant.matchEnvironment != null && credential.environment !== autoGrant.matchEnvironment) {
    return false;
  }

  if (autoGrant.matchType != null && credential.type !== autoGrant.matchType) {
    return false;
  }

  if (autoGrant.matchService != null && credential.service !== autoGrant.matchService) {
    return false;
  }

  if (autoGrant.matchSensitivity != null && credential.sensitivity !== autoGrant.matchSensitivity) {
    return false;
  }

  // For matchTags, credential must have ALL specified tags (subset check)
  if (autoGrant.matchTags != null && autoGrant.matchTags.length > 0) {
    const credTags = credential.tags ?? [];
    if (!autoGrant.matchTags.every((tag) => credTags.includes(tag))) {
      return false;
    }
  }

  return true;
}

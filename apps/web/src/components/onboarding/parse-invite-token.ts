import { INVITE_TOKEN_PREFIX } from "@abadge/core";

/**
 * Extract an invite token from raw user input.
 *
 * Accepts either a bare token (`abi_<chars>`) or a full URL that carries the
 * token in a `?token=` query parameter (`/invite/accept?token=abi_...`,
 * `/join?token=abi_...`, or any other URL shape). Returns the token string
 * if one is present and prefix-valid, otherwise `null`.
 *
 * The prefix check keeps us from accepting unrelated opaque strings the user
 * may paste by accident — the server will still reject invalid tokens, but
 * surfacing a parse failure client-side gives a clearer UX.
 */
export function parseInviteToken(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith(INVITE_TOKEN_PREFIX)) {
    return trimmed;
  }

  // Try to parse as URL and pull `?token=` out of the query string.
  try {
    // Allow pasting "/invite/accept?token=abi_..." (no scheme) by prepending a base.
    const url = new URL(trimmed, "https://placeholder.invalid");
    const candidate = url.searchParams.get("token");
    if (candidate?.startsWith(INVITE_TOKEN_PREFIX)) {
      return candidate;
    }
  } catch {
    // Not a URL; fall through.
  }

  return null;
}

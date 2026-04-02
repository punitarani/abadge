const authErrorMessages: Record<string, string> = {
  access_denied: "Sign-in was canceled before access was allowed.",
  account_already_linked_to_different_user:
    "This social account is already linked to another user.",
  email_is_missing: "Your social account did not return an email address required for sign-in.",
  email_not_found: "Your social account did not return an email address required for sign-in.",
  invalid_callback_url: "Sign-in could not be completed because the callback URL is not allowed.",
  invalid_error_callback_url:
    "Sign-in could not be completed because the error callback URL is not allowed.",
  oauth_provider_not_found: "This sign-in provider is not configured on this server.",
  please_restart_the_process: "The sign-in session expired. Please try again.",
  state_mismatch: "The sign-in session expired. Please try again.",
};

function humanizeAuthError(value: string): string {
  const normalized = value.replace(/[+_]+/g, " ").trim();
  if (normalized.length === 0) {
    return "Could not complete sign-in.";
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function getAuthErrorMessage(searchParams: {
  get(name: string): string | null;
}): string | null {
  const errorCode = searchParams.get("error");

  if (!errorCode) {
    return null;
  }

  const errorDescription = searchParams.get("error_description");
  if (errorDescription) {
    return humanizeAuthError(errorDescription);
  }

  return (
    authErrorMessages[errorCode] ?? `Could not complete sign-in (${humanizeAuthError(errorCode)}).`
  );
}

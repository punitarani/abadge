export function normalizeRedirectPath(
  redirectPath: string | null | undefined,
  fallback = "/items",
): string {
  if (!redirectPath?.startsWith("/") || redirectPath.startsWith("//")) {
    return fallback;
  }

  return redirectPath;
}

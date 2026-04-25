/**
 * The "default" profile is the one named "internal" — the conventional
 * name the onboarding flow suggests for an org's operational vault.
 * Counts how many such profiles exist in the org. Will be 0 when the
 * user has named their first profile something else (no profile is
 * auto-created on org creation).
 *
 * Lives in its own module (not in page.tsx) because Next.js 15 enforces
 * that page files only export `default`, `metadata`, and the other
 * well-known route handles — an arbitrary named export from a page
 * triggers "<name> is not a valid Page export field" at production build.
 */
export function countDefaultProfiles(profiles: ReadonlyArray<{ name: string }>): number {
  return profiles.filter((p) => p.name === "internal").length;
}

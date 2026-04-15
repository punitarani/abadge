/**
 * The "default" profile is the one created during onboarding and named
 * "internal" (see onboarding/page.tsx and organizations.create which
 * seeds the row). Returning the count of server_managed profiles — which
 * the previous implementation did — was wrong: the internal profile is
 * zero_knowledge, not server_managed, so the Overview subtitle always
 * read "0 default (internal)" for a freshly onboarded user.
 *
 * Lives in its own module (not in page.tsx) because Next.js 15 enforces
 * that page files only export `default`, `metadata`, and the other
 * well-known route handles — an arbitrary named export from a page
 * triggers "<name> is not a valid Page export field" at production build.
 */
export function countDefaultProfiles(profiles: ReadonlyArray<{ name: string }>): number {
  return profiles.filter((p) => p.name === "internal").length;
}

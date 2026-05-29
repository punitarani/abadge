/**
 * Breakdown of profiles by storage mode, surfaced as the subtitle of the
 * Overview profiles card (labelled "Profiles under custody" for team orgs,
 * "Profiles" for personal accounts). Replaces the previous
 * `countDefaultProfiles` counter, which was tied to the literal name
 * `internal` — a stable signal only when `organizations.create` still
 * auto-seeded that profile. With the auto-seed gone, "internal" is just
 * the suggested default in onboarding, so a name-based count would read
 * zero for any user who picked something else.
 *
 * Lives in its own module (not in page.tsx) because Next.js 15 enforces
 * that page files only export `default`, `metadata`, and the other
 * well-known route handles — an arbitrary named export from a page
 * triggers "<name> is not a valid Page export field" at production build.
 */

export interface ProfilesByStorage {
  serverManaged: number;
  zeroKnowledge: number;
}

export function countProfilesByStorage(
  profiles: ReadonlyArray<{ storageMode: string }>,
): ProfilesByStorage {
  let serverManaged = 0;
  let zeroKnowledge = 0;
  for (const p of profiles) {
    if (p.storageMode === "server_managed") serverManaged++;
    else if (p.storageMode === "zero_knowledge") zeroKnowledge++;
  }
  return { serverManaged, zeroKnowledge };
}

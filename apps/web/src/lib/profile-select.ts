import type { Profile } from "@abadge/core";

/**
 * Pick the profile to pre-select in the create-item panel. Mirrors the server's
 * default-profile resolution (`resolveTargetProfile`): prefer the org's
 * auto-seeded default (`externalId === "default"`), else the first profile.
 * Returns `undefined` only for an org with no profiles (shouldn't happen — org
 * creation always seeds a default `server_managed` profile).
 */
export function defaultProfileId(profiles: readonly Profile[]): string | undefined {
  const explicitDefault = profiles.find((p) => p.externalId === "default");
  return (explicitDefault ?? profiles[0])?.id;
}

const STORAGE_MODE_LABEL: Record<Profile["storageMode"], string> = {
  server_managed: "server-managed",
  zero_knowledge: "zero-knowledge",
};

/** Dropdown label for a profile, e.g. "default · server-managed". The mode is
 * shown because it determines where the item lives and how it's encrypted. */
export function profileOptionLabel(profile: Profile): string {
  return `${profile.name} · ${STORAGE_MODE_LABEL[profile.storageMode]}`;
}

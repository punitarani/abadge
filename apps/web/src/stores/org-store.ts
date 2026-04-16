import { create } from "zustand";
import { persist } from "zustand/middleware";

interface OrgState {
  activeOrgId: string | null;
  activeOrgSlug: string | null;
  activeOrgName: string | null;
  activeOrgLogo: string | null;
  // Tracks which authenticated user the active org was selected for. The
  // dashboard layout and onboarding page compare this against the current
  // session user id; a mismatch means the persisted org belongs to a prior
  // session (logout without clear, cross-user browser reuse, stale tab) and
  // must be scrubbed before any org-scoped tRPC call fires with a stale
  // X-Abadge-Org-Id header.
  lastUserId: string | null;
  setActiveOrg: (
    userId: string,
    org: { id: string; slug: string; name: string; logo: string | null },
  ) => void;
  clearActiveOrg: () => void;
}

export const useOrgStore = create<OrgState>()(
  persist(
    (set) => ({
      activeOrgId: null,
      activeOrgSlug: null,
      activeOrgName: null,
      activeOrgLogo: null,
      lastUserId: null,
      setActiveOrg: (userId, org) =>
        set({
          activeOrgId: org.id,
          activeOrgSlug: org.slug,
          activeOrgName: org.name,
          activeOrgLogo: org.logo,
          lastUserId: userId,
        }),
      clearActiveOrg: () =>
        set({
          activeOrgId: null,
          activeOrgSlug: null,
          activeOrgName: null,
          activeOrgLogo: null,
          lastUserId: null,
        }),
    }),
    { name: "abadge-org" },
  ),
);

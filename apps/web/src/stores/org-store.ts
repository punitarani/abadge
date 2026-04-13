import { create } from "zustand";
import { persist } from "zustand/middleware";

interface OrgState {
  activeOrgId: string | null;
  activeOrgSlug: string | null;
  activeOrgName: string | null;
  activeOrgLogo: string | null;
  setActiveOrg: (org: { id: string; slug: string; name: string; logo: string | null }) => void;
  clearActiveOrg: () => void;
}

export const useOrgStore = create<OrgState>()(
  persist(
    (set) => ({
      activeOrgId: null,
      activeOrgSlug: null,
      activeOrgName: null,
      activeOrgLogo: null,
      setActiveOrg: (org) =>
        set({
          activeOrgId: org.id,
          activeOrgSlug: org.slug,
          activeOrgName: org.name,
          activeOrgLogo: org.logo,
        }),
      clearActiveOrg: () =>
        set({ activeOrgId: null, activeOrgSlug: null, activeOrgName: null, activeOrgLogo: null }),
    }),
    { name: "abadge-org" },
  ),
);

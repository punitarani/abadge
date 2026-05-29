"use client";

import { useQuery } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient } from "@/lib/trpc-browser";
import { useOrgStore } from "@/stores/org-store";

export interface ActiveOrg {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  isPersonal: boolean;
}

/**
 * Resolve the currently-active workspace and whether it is a personal account.
 *
 * Reads from the same `organizations.list` query the dashboard gate and org
 * switcher already populate (shared React Query key — no extra network round
 * trip) and matches it against the persisted `activeOrgId`.
 *
 * `isPersonal` is the single switch behind the personal-vs-custody distinction
 * across the dashboard. A personal account is the user's OWN vault: they own
 * every secret, can reveal their own values, and the UI must not present the
 * custody framing ("on behalf of your users"). Team organizations stay in
 * custody mode — the dashboard never reveals plaintext there.
 */
export function useActiveOrg(): {
  org: ActiveOrg | null;
  isPersonal: boolean;
  isLoading: boolean;
} {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const { data: session } = authClient.useSession();

  const { data, isPending } = useQuery({
    queryKey: dashboardQueryKeys.organizations(),
    queryFn: () => browserTrpcClient.organizations.list.query(),
    enabled: !!session,
  });

  // The tRPC client surfaces `organizations` loosely (same cast is applied in
  // the org switcher and the dashboard gate). Narrow to the fields we read.
  const orgs = (data?.organizations ?? []) as ReadonlyArray<ActiveOrg>;
  const org = orgs.find((o) => o.id === activeOrgId) ?? null;

  return { org, isPersonal: org?.isPersonal ?? false, isLoading: isPending };
}

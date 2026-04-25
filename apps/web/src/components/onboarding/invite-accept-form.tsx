"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { useOrgStore } from "@/stores/org-store";
import { parseInviteToken } from "./parse-invite-token";

export interface InviteAcceptSuccess {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
}

export interface InviteAcceptFormProps {
  /**
   * Pre-fill the form with a token extracted from the URL. The component still
   * asks the user to confirm acceptance — we never auto-accept a token the
   * page was loaded with, because doing so would make an invite URL
   * click-jackable.
   */
  initialToken?: string;
  /**
   * Called after a successful acceptInvite mutation. Receives the joined org.
   * If omitted, the component redirects the user to `/overview`.
   */
  onSuccess?: (result: InviteAcceptSuccess) => void;
  /**
   * Card: standalone layout for pages (padding, header). Dialog: compact
   * layout for modal dialogs that provide their own chrome.
   */
  variant?: "card" | "dialog";
}

/**
 * Reusable invite-accept form. Three entry points render this:
 *   - /onboarding (step 1 "Join with invite code" choice)
 *   - /join (shareable route, with `?token=` preload)
 *   - dashboard org-switcher ("Join another organization…" dialog)
 *
 * Keeping them on one component prevents drift: any change to the server
 * endpoints, error copy, or success behavior applies everywhere at once.
 */
export function InviteAcceptForm({
  initialToken,
  onSuccess,
  variant = "card",
}: InviteAcceptFormProps): React.ReactElement {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id ?? null;
  const setActiveOrg = useOrgStore((s) => s.setActiveOrg);
  const queryClient = useQueryClient();

  // Raw paste input (not yet validated). Preview loads once we extract a
  // prefix-valid token. `initialToken` is a one-time seed: /join captures the
  // URL token into a ref and never changes it, and the org-switcher dialog
  // never passes one. Re-syncing on prop change would clobber in-progress
  // paste, so we intentionally don't.
  const [rawInput, setRawInput] = useState<string>(() => initialToken ?? "");
  const [parsedToken, setParsedToken] = useState<string | null>(() =>
    initialToken ? parseInviteToken(initialToken) : null,
  );
  const [parseError, setParseError] = useState<string>("");

  const infoQuery = useQuery({
    // `parsedToken` in the key means switching tokens re-fetches instead of
    // returning stale data.
    queryKey: ["invite-info", parsedToken],
    queryFn: () => {
      // Runtime guard rather than `as string` cast: `enabled` already gates
      // this on parsedToken, but a future caller invoking infoQuery outside
      // the current render path would silently send `null` with no compile
      // warning. Throwing here keeps the contract explicit.
      if (!parsedToken) throw new Error("Invite token missing");
      return browserTrpcClient.organizations.members.getInviteInfo.query({
        token: parsedToken,
      });
    },
    enabled: !!parsedToken,
    retry: false,
  });

  const acceptMutation = useMutation({
    mutationFn: () => {
      if (!parsedToken) throw new Error("Invite token missing");
      return browserTrpcClient.organizations.members.acceptInvite.mutate({
        token: parsedToken,
      });
    },
    onSuccess: (data) => {
      // The accept flow is gated on an authenticated session (the route
      // wrapping this component redirects unauthenticated users), so userId
      // is non-null here in practice. Skip the store update if the session
      // is somehow absent rather than seeding lastUserId with a placeholder.
      if (userId) {
        setActiveOrg(userId, {
          id: data.organizationId,
          slug: data.organizationSlug,
          name: data.organizationName,
          logo: null,
        });
      }
      // Refresh the org list so the switcher + dashboard pick up the new
      // membership without a hard reload.
      void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.organizations() });
      toast.success(`Joined ${data.organizationName}`);
      if (onSuccess) {
        onSuccess({
          organizationId: data.organizationId,
          organizationName: data.organizationName,
          organizationSlug: data.organizationSlug,
        });
      } else {
        router.push("/overview");
      }
    },
    onError: (error) => {
      toast.error(getClientErrorMessage(error, "Failed to accept invitation"));
    },
  });

  function handleLookup(e: React.FormEvent): void {
    e.preventDefault();
    setParseError("");
    const token = parseInviteToken(rawInput);
    if (!token) {
      setParseError(
        "That doesn't look like a valid invite. Paste the full invite link or the code that starts with abi_.",
      );
      setParsedToken(null);
      return;
    }
    setParsedToken(token);
  }

  const spacing = variant === "dialog" ? "space-y-4" : "space-y-5";

  // Initial (no token yet): show the paste input.
  if (!parsedToken) {
    return (
      <form onSubmit={handleLookup} className={spacing}>
        <div className="space-y-1.5">
          <Label htmlFor="invite-token">Invite link or code</Label>
          <Input
            id="invite-token"
            type="text"
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            placeholder="Paste invite link or abi_…"
            autoComplete="off"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            You can paste the full invite URL your admin shared, or just the code that starts with{" "}
            <code className="font-mono">abi_</code>.
          </p>
        </div>
        {parseError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {parseError}
          </div>
        )}
        <Button type="submit" className="w-full" disabled={rawInput.trim().length === 0}>
          Look up invite
        </Button>
      </form>
    );
  }

  // Looking up: spinner-free, just a muted line so small dialogs don't jump.
  if (infoQuery.isPending) {
    return (
      <div className={spacing}>
        <p className="text-sm text-muted-foreground">Looking up invite…</p>
      </div>
    );
  }

  // Lookup failed (bad token, expired, revoked, rate-limited). Let the user
  // paste a different one.
  if (infoQuery.isError) {
    return (
      <div className={spacing}>
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {getClientErrorMessage(infoQuery.error, "This invite link is invalid or has expired.")}
        </div>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => {
            setParsedToken(null);
            setRawInput("");
            setParseError("");
          }}
        >
          Try a different invite
        </Button>
      </div>
    );
  }

  const info = infoQuery.data;

  return (
    <div className={spacing}>
      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          You're invited to
        </div>
        <div className="mt-1 text-base font-semibold">{info.organizationName}</div>
        <div className="mt-1 text-sm text-muted-foreground">
          You will join as <strong>{info.role}</strong>.
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          className="flex-1"
          onClick={() => acceptMutation.mutate()}
          disabled={acceptMutation.isPending}
        >
          {acceptMutation.isPending ? "Joining…" : `Join ${info.organizationName}`}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setParsedToken(null);
            setRawInput("");
          }}
          disabled={acceptMutation.isPending}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

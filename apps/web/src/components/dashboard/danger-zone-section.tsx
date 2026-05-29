"use client";

import { CheckCircle, Trash, Warning } from "@phosphor-icons/react";
import { useMutation, type useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient } from "@/lib/trpc-browser";
import { workspacePosture } from "@/lib/workspace-posture";
import { classifyDeletionError, evaluateDeleteGate } from "./danger-zone-section.helpers";

/**
 * Danger zone: permanently delete the active organization / personal account.
 *
 * Two confirmation gates, mirroring GitHub / Linear / PlanetScale:
 *   1. type the workspace name — proves the user knows *which* workspace they
 *      are destroying (the specificity gate), and
 *   2. re-enter the account password — proves it is really them (the re-auth
 *      gate; a hijacked session must not be able to wipe the vault).
 *
 * The server (`organizations.delete`) re-checks both and audits every attempt,
 * so the client gate is friction, not the security boundary. The submit control
 * is a real form submit — *not* a Radix `AlertDialogAction` — so a failed
 * attempt (wrong password) keeps the dialog open with an inline error instead
 * of dismissing it and leaving only a toast.
 */
export function DangerZoneSection({
  orgId,
  orgName,
  itemCount,
  itemsLoading,
  isPersonal,
  queryClient,
  router,
}: {
  orgId: string;
  orgName: string;
  itemCount: number;
  itemsLoading: boolean;
  isPersonal: boolean;
  queryClient: ReturnType<typeof useQueryClient>;
  router: { push: (href: string) => void };
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const { accountNounLower: noun } = workspacePosture(isPersonal);
  const hasItems = itemCount > 0;
  // The exact name the user must type. Trimmed so the label, the displayed
  // target, the placeholder, and the equality check all agree even if the
  // server ever returns a name with surrounding whitespace.
  const confirmName = orgName.trim();

  function resetForm(): void {
    setConfirmText("");
    setPassword("");
    setPasswordError(null);
    setFormError(null);
  }

  async function finishDeleted(): Promise<void> {
    // Mark the org list stale before navigating, so if anything renders the
    // dashboard before the route change completes it doesn't show the
    // just-deleted workspace. Mirrors the pre-refactor onSuccess ordering.
    await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.organizations() });
    toast.success(isPersonal ? "Personal account deleted." : "Organization deleted.");
    router.push("/onboarding");
  }

  const deleteMutation = useMutation({
    mutationFn: () =>
      browserTrpcClient.organizations.delete.mutate({
        orgId,
        confirmName: confirmText.trim(),
        password,
      }),
    onSuccess: () => finishDeleted(),
    onError: (error) => {
      const failure = classifyDeletionError(error, `Failed to delete ${noun}`);
      if (failure.kind === "password") {
        // Surface it on the field, clear it, and refocus so a retry is one
        // keystroke away. The server has already logged the denied attempt.
        setFormError(null);
        setPasswordError(failure.message);
        setPassword("");
        passwordRef.current?.focus();
        return;
      }
      if (failure.kind === "gone") {
        // Already gone (e.g. deleted from another tab) — treat as done.
        setOpen(false);
        resetForm();
        void finishDeleted();
        return;
      }
      setPasswordError(null);
      setFormError(failure.message);
    },
  });

  const { nameMatches, canSubmit } = evaluateDeleteGate({
    confirmText,
    confirmName,
    password,
    pending: deleteMutation.isPending,
  });

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (!canSubmit) return;
    setFormError(null);
    setPasswordError(null);
    deleteMutation.mutate();
  }

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>

      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">Delete this {noun}</p>
            <p className="text-sm text-muted-foreground">
              Permanently delete this {noun} and all of its data. This action cannot be undone.
            </p>
            <DeletionItemsWarning loading={itemsLoading} itemCount={itemCount} />
          </div>
          <Button
            variant="destructive"
            size="sm"
            className="shrink-0"
            disabled={itemsLoading}
            onClick={() => setOpen(true)}
          >
            <Trash className="mr-1 h-3.5 w-3.5" />
            Delete
          </Button>
        </div>
      </div>

      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          // Don't let an in-flight delete be dismissed out from under itself.
          if (!next && deleteMutation.isPending) return;
          setOpen(next);
          if (!next) resetForm();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {noun}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes{" "}
              <span className="font-medium text-foreground">{confirmName}</span>
              {hasItems ? (
                <>
                  {" and its "}
                  <span className="font-medium text-foreground">
                    {itemCount} item{itemCount === 1 ? "" : "s"}
                  </span>
                  , profiles, agents, and permissions.
                </>
              ) : (
                " and all of its profiles, agents, and permissions."
              )}{" "}
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-name">Type the {noun} name to confirm</Label>
              <div className="rounded-md border border-border bg-muted/40 px-2.5 py-1.5 font-mono text-xs break-all text-muted-foreground select-all">
                {confirmName}
              </div>
              <div className="relative">
                <Input
                  id="confirm-name"
                  value={confirmText}
                  onChange={(event) => {
                    setConfirmText(event.target.value);
                    if (formError) setFormError(null);
                  }}
                  placeholder={confirmName}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  className={nameMatches ? "pr-9" : undefined}
                />
                {nameMatches && (
                  <CheckCircle
                    weight="fill"
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 right-2.5 h-4 w-4 -translate-y-1/2 text-emerald-500"
                  />
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Confirm your password</Label>
              <Input
                ref={passwordRef}
                id="confirm-password"
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  if (passwordError) setPasswordError(null);
                }}
                placeholder="Your account password"
                autoComplete="current-password"
                aria-invalid={passwordError ? true : undefined}
                aria-describedby={passwordError ? "confirm-password-error" : undefined}
              />
              {passwordError && (
                <p id="confirm-password-error" className="text-xs text-destructive">
                  {passwordError}
                </p>
              )}
            </div>

            {formError && (
              <p
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {formError}
              </p>
            )}

            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={deleteMutation.isPending}>
                Cancel
              </AlertDialogCancel>
              <Button type="submit" variant="destructive" disabled={!canSubmit}>
                {deleteMutation.isPending ? "Deleting…" : `Delete ${noun}`}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** The "N items will be permanently deleted" line in the danger-zone card. */
function DeletionItemsWarning({
  loading,
  itemCount,
}: {
  loading: boolean;
  itemCount: number;
}): React.ReactElement | null {
  if (loading) {
    return <p className="text-xs text-muted-foreground">Checking for items…</p>;
  }
  if (itemCount <= 0) {
    return null;
  }
  return (
    <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
      <Warning weight="fill" className="h-3.5 w-3.5 shrink-0" />
      {itemCount} item{itemCount === 1 ? "" : "s"} will be permanently deleted
    </p>
  );
}

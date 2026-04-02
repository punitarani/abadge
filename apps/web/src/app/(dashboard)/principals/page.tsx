"use client";

import type { Principal } from "@abadge/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SecretDisplay } from "@/components/ui/secret-display";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { formatRelativeTime } from "@/lib/utils";

function PrincipalRow({
  principal,
  onRotate,
  onRevoke,
  mutating,
}: {
  principal: Principal;
  onRotate: (principalId: string) => void;
  onRevoke: (principalId: string) => void;
  mutating: boolean;
}): React.ReactElement {
  const isActive = principal.enabled && principal.revokedAt === null;

  return (
    <TableRow>
      <TableCell className="font-medium">{principal.name}</TableCell>
      <TableCell>
        <Badge variant="secondary">{principal.kind}</Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">{principal.locality}</TableCell>
      <TableCell>
        {principal.secretPrefix ? (
          <code className="text-xs bg-neutral-100 px-1.5 py-0.5 rounded font-mono">
            {principal.secretPrefix}
          </code>
        ) : (
          <span className="text-muted-foreground">{"\u2014"}</span>
        )}
      </TableCell>
      <TableCell>
        <Badge variant={isActive ? "success" : "destructive"}>
          {isActive ? "Active" : "Revoked"}
        </Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {principal.lastUsedAt ? formatRelativeTime(principal.lastUsedAt) : "Never"}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {formatRelativeTime(principal.createdAt)}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          {isActive ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={mutating}
                onClick={() => onRotate(principal.id)}
              >
                Rotate key
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={mutating}
                onClick={() => onRevoke(principal.id)}
              >
                Revoke
              </Button>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">No actions</span>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

export default function PrincipalsPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);
  const principalsQuery = useQuery({
    queryKey: dashboardQueryKeys.principals(),
    queryFn: () => browserTrpcClient.principals.list.query(),
  });
  const rotatePrincipal = useMutation({
    mutationFn: ({ principalId }: { principalId: string }) =>
      browserTrpcClient.principals.rotate.mutate({ principalId }),
    onSuccess: async (result) => {
      setRotatedSecret(result.secret);
      await queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.principals(),
      });
    },
  });
  const revokePrincipal = useMutation({
    mutationFn: ({ principalId }: { principalId: string }) =>
      browserTrpcClient.principals.revoke.mutate({ principalId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.principals(),
      });
    },
  });

  const principals = principalsQuery.data?.principals ?? [];
  const loading = principalsQuery.isPending;

  async function handleRotate(principalId: string): Promise<void> {
    await rotatePrincipal.mutateAsync({ principalId });
  }

  async function handleRevoke(principalId: string): Promise<void> {
    if (!confirm("Revoke this principal? Existing grants will no longer work.")) {
      return;
    }

    await revokePrincipal.mutateAsync({ principalId });
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Principals</h1>
          <p className="text-sm text-muted-foreground">
            Agents and services that can access your vault
          </p>
        </div>
        <Button size="sm" asChild>
          <Link href="/principals/new">Register principal</Link>
        </Button>
      </div>

      {rotatedSecret ? (
        <div className="border border-border rounded-lg p-5 space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Rotated API key</h2>
            <p className="text-sm text-muted-foreground">
              Save this key now. It will not be shown again.
            </p>
          </div>
          <SecretDisplay value={rotatedSecret} />
          <Button variant="outline" size="sm" onClick={() => setRotatedSecret(null)}>
            Dismiss
          </Button>
        </div>
      ) : null}

      <div className="border border-border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Locality</TableHead>
              <TableHead>Key prefix</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {principalsQuery.error ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-red-700">
                  {getClientErrorMessage(principalsQuery.error, "Failed to load principals")}
                </TableCell>
              </TableRow>
            ) : loading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : principals.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                  <div className="space-y-2">
                    <div className="font-medium text-foreground">No principals registered</div>
                    <div>
                      <Link href="/principals/new" className="text-link hover:underline">
                        Register your first principal
                      </Link>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              principals.map((p: Principal) => (
                <PrincipalRow
                  key={p.id}
                  principal={p}
                  onRotate={handleRotate}
                  onRevoke={handleRevoke}
                  mutating={rotatePrincipal.isPending || revokePrincipal.isPending}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

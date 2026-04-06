"use client";

import type { ItemSummary } from "@abadge/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export default function ItemsPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const itemsQuery = useQuery({
    queryKey: dashboardQueryKeys.items(),
    queryFn: () => browserTrpcClient.items.list.query(),
  });
  const deleteItem = useMutation({
    mutationFn: ({ itemId }: { itemId: string }) =>
      browserTrpcClient.items.delete.mutate({ itemId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.items(),
      });
    },
  });

  const items = itemsQuery.data?.items ?? [];
  const loading = itemsQuery.isPending;

  async function handleDelete(itemId: string): Promise<void> {
    if (!confirm("Delete this item? This cannot be undone.")) {
      return;
    }

    await deleteItem.mutateAsync({ itemId });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Items</h1>
          <p className="text-sm text-muted-foreground">Secrets stored in your vault</p>
        </div>
        <Button size="sm" asChild>
          <Link href="/items/new">Create item</Link>
        </Button>
      </div>

      <div className="border border-border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Storage</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {itemsQuery.error ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-red-700">
                  {getClientErrorMessage(itemsQuery.error, "Failed to load items")}
                </TableCell>
              </TableRow>
            ) : loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                  <div className="space-y-2">
                    <div className="font-medium text-foreground">No items yet</div>
                    <div>Add your first secret to get started.</div>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              items.map((item: ItemSummary) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/items/${item.id}`}
                      className="font-mono text-foreground hover:underline"
                    >
                      {item.id.slice(0, 13)}…
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={item.storageMode === "zero_knowledge" ? "default" : "secondary"}
                    >
                      {item.storageMode === "zero_knowledge" ? "Zero-knowledge" : "Server-managed"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatRelativeTime(item.createdAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatRelativeTime(item.updatedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/items/${item.id}`}>View</Link>
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={deleteItem.isPending}
                        onClick={() => handleDelete(item.id)}
                      >
                        {deleteItem.isPending ? "Deleting..." : "Delete"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

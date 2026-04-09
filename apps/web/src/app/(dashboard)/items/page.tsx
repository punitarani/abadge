"use client";

import type { ItemSummary } from "@abadge/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryStates } from "nuqs";
import { useState } from "react";
import { toast } from "sonner";
import { CreateItemPanel } from "@/components/dashboard/create-item-panel";
import { ItemDetailPanel } from "@/components/dashboard/item-detail-panel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { itemPanelParsers } from "@/lib/query-state";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { useItemLabels } from "@/lib/use-item-labels";
import { formatRelativeTime } from "@/lib/utils";

export default function ItemsPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [{ create: createPanelOpen, item: activeItemId }, setItemPanelState] =
    useQueryStates(itemPanelParsers);
  const itemsQuery = useQuery({
    queryKey: dashboardQueryKeys.items(),
    queryFn: () => browserTrpcClient.items.list.query(),
  });

  const items = itemsQuery.data?.items ?? [];
  const { labelMap } = useItemLabels(items);

  const deleteItem = useMutation({
    mutationFn: ({ itemId }: { itemId: string }) =>
      browserTrpcClient.items.delete.mutate({ itemId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.items(),
      });
    },
  });

  const loading = itemsQuery.isPending;

  async function handleConfirmDelete(): Promise<void> {
    if (!itemToDelete) return;
    try {
      await deleteItem.mutateAsync({ itemId: itemToDelete });
      toast.success("Item deleted.");
    } catch (error) {
      toast.error(getClientErrorMessage(error, "Failed to delete item"));
    } finally {
      setItemToDelete(null);
    }
  }

  function itemLabel(item: ItemSummary): string {
    return labelMap.get(item.id) ?? `${item.id.slice(0, 8)}…`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Items</h1>
          <p className="text-sm text-muted-foreground">Secrets stored in your vault</p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            void setItemPanelState({ create: true });
          }}
        >
          Create item
        </Button>
      </div>

      <div className="border border-border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
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
                  <TableCell>
                    <button
                      type="button"
                      className="text-left hover:underline"
                      onClick={() => {
                        void setItemPanelState({ item: item.id });
                      }}
                    >
                      <div className="font-medium text-foreground">{itemLabel(item)}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {item.id.slice(0, 8)}…
                      </div>
                    </button>
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
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          void setItemPanelState({ item: item.id });
                        }}
                      >
                        View
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={deleteItem.isPending}
                        onClick={() => setItemToDelete(item.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <CreateItemPanel
        open={createPanelOpen}
        onClose={() => {
          void setItemPanelState({ create: null });
        }}
      />

      {activeItemId ? (
        <ItemDetailPanel
          itemId={activeItemId}
          open
          onClose={() => {
            void setItemPanelState({ item: null });
          }}
        />
      ) : null}

      <AlertDialog
        open={itemToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setItemToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this item?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the item and all associated permissions. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void handleConfirmDelete()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

"use client";

import { clientEnv } from "@abadge/env/client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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
import { formatRelativeTime } from "@/lib/utils";

interface Item {
  id: string;
  name: string;
  storageMode: string;
  createdAt: string;
  updatedAt: string;
}

export default function ItemsPage(): React.ReactElement {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const apiUrl = clientEnv.NEXT_PUBLIC_API_URL;

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/v1/items`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setItems(data.items ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  async function handleDelete(id: string): Promise<void> {
    if (!confirm("Delete this item? This cannot be undone.")) return;
    const res = await fetch(`${apiUrl}/v1/items/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) {
      fetchItems();
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
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
              <TableHead>Name</TableHead>
              <TableHead>Storage</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
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
              items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">
                    <Link href={`/items/${item.id}`} className="text-foreground hover:underline">
                      {item.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.storageMode === "zk" ? "default" : "secondary"}>
                      {item.storageMode === "zk" ? "Zero-knowledge" : "Server-managed"}
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
                      <Button variant="destructive" size="sm" onClick={() => handleDelete(item.id)}>
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
    </div>
  );
}

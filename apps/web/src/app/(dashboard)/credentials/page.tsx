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
import {
  deliveryModeLabels,
  environmentStyles,
  sensitivityVariants,
  typeLabels,
} from "@/lib/credential-ui";
import { formatRelativeTime } from "@/lib/utils";

interface Credential {
  id: string;
  name: string;
  type: string;
  environment: string | null;
  sensitivity: string | null;
  service: string | null;
  allowedDeliveryModes: string[] | null;
  metadata: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
}

export default function CredentialsPage(): React.ReactElement {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);

  const apiUrl = clientEnv.NEXT_PUBLIC_API_URL;

  const fetchCredentials = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/v1/credentials`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setCredentials(data.credentials);
      }
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    fetchCredentials();
  }, [fetchCredentials]);

  async function handleDelete(id: string): Promise<void> {
    if (!confirm("Delete this credential? This cannot be undone.")) return;
    const res = await fetch(`${apiUrl}/v1/credentials/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) {
      fetchCredentials();
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Credentials</h1>
          <p className="text-sm text-muted-foreground">Encrypted secrets stored in your vault</p>
        </div>
        <Button size="sm" asChild>
          <Link href="/credentials/new">Create credential</Link>
        </Button>
      </div>

      <div className="border border-border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Environment</TableHead>
              <TableHead>Sensitivity</TableHead>
              <TableHead>Service</TableHead>
              <TableHead>Delivery</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : credentials.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                  <div className="space-y-2">
                    <div className="font-medium text-foreground">No credentials yet</div>
                    <div>Add your first secret to get started.</div>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              credentials.map((cred) => (
                <TableRow key={cred.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/credentials/${cred.id}`}
                      className="text-foreground hover:underline"
                    >
                      {cred.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{typeLabels[cred.type] ?? cred.type}</Badge>
                  </TableCell>
                  <TableCell>
                    {cred.environment ? (
                      <Badge
                        variant="outline"
                        className={environmentStyles[cred.environment] ?? ""}
                      >
                        {cred.environment}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">&mdash;</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {cred.sensitivity ? (
                      <Badge variant={sensitivityVariants[cred.sensitivity]?.variant ?? "default"}>
                        {cred.sensitivity}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">&mdash;</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {cred.service ?? "\u2014"}
                  </TableCell>
                  <TableCell>
                    {cred.allowedDeliveryModes && cred.allowedDeliveryModes.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {cred.allowedDeliveryModes.map((mode) => (
                          <Badge key={mode} variant="outline" className="text-[10px] px-1.5">
                            {deliveryModeLabels[mode] ?? mode}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">&mdash;</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatRelativeTime(cred.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/credentials/${cred.id}`}>Manage</Link>
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => handleDelete(cred.id)}>
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

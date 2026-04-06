"use client";

import { useParams, useRouter } from "next/navigation";
import { ItemDetailPanel } from "@/components/dashboard/item-detail-panel";

export default function ItemDetailPage(): React.ReactElement {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  return <ItemDetailPanel itemId={id} presentation="page" onClose={() => router.push("/items")} />;
}

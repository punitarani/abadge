"use client";

import { useParams, useRouter } from "next/navigation";
import { ItemDetailPanel } from "@/components/dashboard/item-detail-panel";

export default function ItemDetailOverlayPage(): React.ReactElement {
  const params = useParams();
  const router = useRouter();

  return (
    <ItemDetailPanel
      itemId={params.id as string}
      presentation="overlay"
      onClose={() => router.replace("/items")}
    />
  );
}

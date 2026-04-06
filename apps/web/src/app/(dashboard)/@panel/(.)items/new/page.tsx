"use client";

import { useRouter } from "next/navigation";
import { CreateItemPanel } from "@/components/dashboard/create-item-panel";

export default function CreateItemOverlayPage(): React.ReactElement {
  const router = useRouter();

  return <CreateItemPanel presentation="overlay" onClose={() => router.replace("/items")} />;
}

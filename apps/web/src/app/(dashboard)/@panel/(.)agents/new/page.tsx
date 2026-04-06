"use client";

import { useRouter } from "next/navigation";
import { CreateAgentPanel } from "@/components/dashboard/create-agent-panel";

export default function CreateAgentOverlayPage(): React.ReactElement {
  const router = useRouter();

  return <CreateAgentPanel presentation="overlay" onClose={() => router.replace("/agents")} />;
}

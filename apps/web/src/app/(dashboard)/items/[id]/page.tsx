import { redirect } from "next/navigation";

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<never> {
  const { id } = await params;
  redirect(`/items?item=${encodeURIComponent(id)}`);
}

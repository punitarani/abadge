import { DetailSkeleton } from "@/components/dashboard/skeletons/detail-skeleton";

export default function Loading(): React.ReactElement {
  return <DetailSkeleton metadataCount={5} />;
}

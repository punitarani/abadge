import { TableSkeleton } from "@/components/dashboard/skeletons/table-skeleton";

export default function Loading(): React.ReactElement {
  return <TableSkeleton filterCount={4} columnCount={5} />;
}

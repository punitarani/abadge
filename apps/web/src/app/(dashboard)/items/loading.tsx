import { TableSkeleton } from "@/components/dashboard/skeletons/table-skeleton";

export default function Loading(): React.ReactElement {
  return <TableSkeleton filterCount={2} columnCount={5} />;
}

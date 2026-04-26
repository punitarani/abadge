import { TableSkeleton } from "@/components/dashboard/skeletons/table-skeleton";

export default function Loading(): React.ReactElement {
  return (
    <TableSkeleton
      breadcrumb={false}
      filterCount={4}
      columnCount={6}
      action={false}
      rowCount={10}
    />
  );
}

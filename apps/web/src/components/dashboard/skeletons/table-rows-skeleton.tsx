import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";

interface TableRowsSkeletonProps {
  /** Number of skeleton rows to render. */
  rows?: number;
  /**
   * Number of cells per row. MUST match the table's column count so the
   * shimmer lines up with the loaded header and data arriving never shifts the
   * layout.
   */
  columns: number;
  /**
   * When true the trailing column renders a fixed-width, right-aligned
   * placeholder mimicking a row action (View / Revoke / Remove) rather than a
   * flexible data cell.
   */
  action?: boolean;
}

/**
 * The single source of in-table loading shimmer across the dashboard — lists,
 * detail sections, and settings all render this inside their real `<TableBody>`
 * (a client component) while a query is pending. Because it reuses the page's
 * actual `<Table>` cells, the skeleton column widths line up exactly with the
 * loaded rows, so the transition from loading to data never reflows.
 *
 * The div-based route skeletons in `table-skeleton.tsx` / `settings-skeleton.tsx`
 * deliberately mirror this look for the server-rendered `loading.tsx` fallback,
 * where the client `<Table>` cannot be pulled in.
 */
export function TableRowsSkeleton({
  rows = 5,
  columns,
  action = false,
}: TableRowsSkeletonProps): React.ReactElement {
  return (
    <>
      {Array.from({ length: rows }).map((_, rowIdx) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: order-stable, length-stable skeleton
        <TableRow key={rowIdx} className="hover:bg-transparent">
          {Array.from({ length: columns }).map((_, colIdx) => {
            const isAction = action && colIdx === columns - 1;
            return (
              <TableCell
                // biome-ignore lint/suspicious/noArrayIndexKey: order-stable, length-stable skeleton
                key={colIdx}
                className={isAction ? "text-right" : undefined}
              >
                {isAction ? (
                  <Skeleton className="ml-auto h-8 w-16" />
                ) : (
                  <Skeleton
                    className="h-4"
                    style={{
                      width: colIdx === 0 ? "65%" : `${45 + ((rowIdx + colIdx) % 3) * 12}%`,
                    }}
                  />
                )}
              </TableCell>
            );
          })}
        </TableRow>
      ))}
    </>
  );
}

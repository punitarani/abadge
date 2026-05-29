// TableRowsSkeleton renders the loading rows for every dashboard table. The
// pages rely on it producing exactly `columns` cells per row so the skeleton
// lines up with the loaded header; these tests lock that contract plus the
// opt-in right-aligned trailing action placeholder.
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { TableRowsSkeleton } from "./table-rows-skeleton";

function renderRows(props: { rows?: number; columns: number; action?: boolean }): HTMLElement {
  const { container } = render(
    <table>
      <tbody>
        <TableRowsSkeleton {...props} />
      </tbody>
    </table>,
  );
  return container;
}

describe("TableRowsSkeleton", () => {
  afterEach(cleanup);

  test("renders the requested number of rows and columns", () => {
    const container = renderRows({ rows: 2, columns: 4 });
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(container.querySelectorAll("tbody td")).toHaveLength(8);
  });

  test("defaults to five rows", () => {
    const container = renderRows({ columns: 6 });
    expect(container.querySelectorAll("tbody tr")).toHaveLength(5);
    expect(container.querySelectorAll("tbody td")).toHaveLength(30);
  });

  test("renders only flexible data cells when action is not set", () => {
    const container = renderRows({ rows: 1, columns: 3 });
    const cells = container.querySelectorAll("tbody tr:first-child td");
    const lastSkeleton = cells[cells.length - 1]?.querySelector('[data-slot="skeleton"]');

    // No action column: every cell — including the trailing one — is a flexible
    // data placeholder, never the fixed-width right-aligned button stand-in.
    expect(lastSkeleton?.className).not.toContain("ml-auto");
    expect(lastSkeleton?.className).not.toContain("w-16");
  });

  test("right-aligns an action placeholder in the trailing column when action is set", () => {
    const container = renderRows({ rows: 1, columns: 3, action: true });
    const cells = container.querySelectorAll("tbody tr:first-child td");

    const firstSkeleton = cells[0]?.querySelector('[data-slot="skeleton"]');
    const lastSkeleton = cells[cells.length - 1]?.querySelector('[data-slot="skeleton"]');

    // The trailing cell mimics the Remove/Revoke button: right-aligned, fixed
    // width. Data cells use a flexible inline width and no auto margin.
    expect(lastSkeleton?.className).toContain("w-16");
    expect(lastSkeleton?.className).toContain("ml-auto");
    expect(firstSkeleton?.className).not.toContain("ml-auto");
  });
});

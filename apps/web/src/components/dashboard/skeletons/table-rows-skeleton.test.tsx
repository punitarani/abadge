// TableRowsSkeleton renders the loading rows for every dashboard table. The
// pages rely on it producing exactly `columns` cells per shimmer row so the
// skeleton lines up with the loaded header; these tests lock that contract, the
// opt-in right-aligned trailing action placeholder, and the assistive-tech
// loading announcement (the shimmer rows are decorative/`aria-hidden`, with a
// single `role="status"` row carrying the signal the old "Loading..." cell had).
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { TableRowsSkeleton } from "./table-rows-skeleton";

function renderRows(props: {
  rows?: number;
  columns: number;
  action?: boolean;
  label?: string;
}): HTMLElement {
  const { container } = render(
    <table>
      <tbody>
        <TableRowsSkeleton {...props} />
      </tbody>
    </table>,
  );
  return container;
}

function shimmerRows(container: HTMLElement): NodeListOf<Element> {
  return container.querySelectorAll('tbody tr[aria-hidden="true"]');
}

describe("TableRowsSkeleton", () => {
  afterEach(cleanup);

  test("renders the requested number of shimmer rows and columns", () => {
    const container = renderRows({ rows: 2, columns: 4 });
    expect(shimmerRows(container)).toHaveLength(2);
    expect(container.querySelectorAll('tbody tr[aria-hidden="true"] td')).toHaveLength(8);
  });

  test("defaults to five shimmer rows", () => {
    const container = renderRows({ columns: 6 });
    expect(shimmerRows(container)).toHaveLength(5);
    expect(container.querySelectorAll('tbody tr[aria-hidden="true"] td')).toHaveLength(30);
  });

  test("announces a loading status to assistive tech", () => {
    const container = renderRows({ rows: 2, columns: 3, label: "Loading items…" });
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toBe("Loading items…");
    // Every shimmer row is hidden from the a11y tree so screen readers get the
    // single status signal instead of a wall of empty placeholder cells.
    expect(shimmerRows(container)).toHaveLength(2);
  });

  test("renders only flexible data cells when action is not set", () => {
    const container = renderRows({ rows: 1, columns: 3 });
    const cells = shimmerRows(container)[0]?.querySelectorAll("td");
    const lastSkeleton = cells?.[cells.length - 1]?.querySelector('[data-slot="skeleton"]');

    // No action column: every cell — including the trailing one — is a flexible
    // data placeholder, never the fixed-width right-aligned button stand-in.
    expect(lastSkeleton?.className).not.toContain("ml-auto");
    expect(lastSkeleton?.className).not.toContain("w-16");
  });

  test("right-aligns an action placeholder in the trailing column when action is set", () => {
    const container = renderRows({ rows: 1, columns: 3, action: true });
    const cells = shimmerRows(container)[0]?.querySelectorAll("td");

    const firstSkeleton = cells?.[0]?.querySelector('[data-slot="skeleton"]');
    const lastSkeleton = cells?.[cells.length - 1]?.querySelector('[data-slot="skeleton"]');

    // The trailing cell mimics the Remove/Revoke button: right-aligned, fixed
    // width. Data cells use a flexible inline width and no auto margin.
    expect(lastSkeleton?.className).toContain("w-16");
    expect(lastSkeleton?.className).toContain("ml-auto");
    expect(firstSkeleton?.className).not.toContain("ml-auto");
  });
});

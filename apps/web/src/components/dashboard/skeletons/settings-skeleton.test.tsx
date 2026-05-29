// SettingsTableRowsSkeleton renders the loading rows for the settings tables.
// The page relies on it producing exactly `columns` cells per row so the
// skeleton lines up with the loaded table header; these tests lock that
// contract and the right-aligned trailing action placeholder.
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { SettingsTableRowsSkeleton } from "./settings-skeleton";

function renderRows(props: { rows?: number; columns: number }): HTMLElement {
  const { container } = render(
    <table>
      <tbody>
        <SettingsTableRowsSkeleton {...props} />
      </tbody>
    </table>,
  );
  return container;
}

describe("SettingsTableRowsSkeleton", () => {
  afterEach(cleanup);

  test("renders the requested number of rows and columns", () => {
    const container = renderRows({ rows: 2, columns: 4 });
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(container.querySelectorAll("tbody td")).toHaveLength(8);
  });

  test("defaults to three rows", () => {
    const container = renderRows({ columns: 6 });
    expect(container.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(container.querySelectorAll("tbody td")).toHaveLength(18);
  });

  test("right-aligns an action placeholder in the trailing column only", () => {
    const container = renderRows({ rows: 1, columns: 3 });
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

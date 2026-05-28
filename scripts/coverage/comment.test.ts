import { describe, expect, it } from "bun:test";
import {
  diffBucket,
  fmtDelta,
  fmtPct,
  overallVerdict,
  parseLcov,
  renderComment,
  type Totals,
} from "./comment";

const totals = (linesHit: number, linesFound: number, funcsHit = 0, funcsFound = 0): Totals => ({
  files: 1,
  linesHit,
  linesFound,
  funcsHit,
  funcsFound,
});

describe("parseLcov", () => {
  it("sums LF/LH/FNF/FNH and counts SF records", () => {
    const lcov = [
      "SF:a.ts",
      "FNF:2",
      "FNH:1",
      "LF:10",
      "LH:8",
      "end_of_record",
      "SF:b.ts",
      "FNF:4",
      "FNH:4",
      "LF:20",
      "LH:15",
      "end_of_record",
    ].join("\n");
    expect(parseLcov(lcov)).toEqual({
      files: 2,
      funcsFound: 6,
      funcsHit: 5,
      linesFound: 30,
      linesHit: 23,
    });
  });
});

describe("diffBucket", () => {
  it("reports improved when a metric rises and none falls", () => {
    const d = diffBucket(totals(9, 10, 5, 10), totals(8, 10, 5, 10));
    expect(d.verdict).toBe("improved");
    expect(d.lineDelta).toBe(10);
    expect(d.funcDelta).toBe(0);
  });

  it("reports worsened when any metric falls, even if another rises", () => {
    const d = diffBucket(totals(7, 10, 6, 10), totals(8, 10, 5, 10));
    expect(d.verdict).toBe("worsened");
    expect(d.lineDelta).toBe(-10);
    expect(d.funcDelta).toBe(10);
  });

  it("reports maintained when nothing changes", () => {
    expect(diffBucket(totals(8, 10, 5, 10), totals(8, 10, 5, 10)).verdict).toBe("maintained");
  });

  it("reports n/a when either side is missing", () => {
    expect(diffBucket(totals(8, 10), null).verdict).toBe("n/a");
    expect(diffBucket(null, totals(8, 10)).verdict).toBe("n/a");
  });

  it("ignores sub-0.005% noise by comparing rounded percentages", () => {
    // 8/9 vs 80000/90000 are mathematically equal; both round to 88.89%.
    expect(diffBucket(totals(8, 9), totals(80000, 90000)).verdict).toBe("maintained");
  });
});

describe("overallVerdict", () => {
  it("lets a regression in any bucket win", () => {
    expect(overallVerdict(["improved", "worsened"])).toBe("worsened");
  });

  it("is improved when something rose and nothing fell", () => {
    expect(overallVerdict(["maintained", "improved"])).toBe("improved");
  });

  it("is maintained when everything held", () => {
    expect(overallVerdict(["maintained", "maintained"])).toBe("maintained");
  });

  it("is n/a only when no bucket is comparable", () => {
    expect(overallVerdict(["n/a", "n/a"])).toBe("n/a");
    expect(overallVerdict(["n/a", "improved"])).toBe("improved");
  });
});

describe("formatters", () => {
  it("formats percentages and an em dash for the undefined ratio", () => {
    expect(fmtPct(88.888)).toBe("88.89%");
    expect(fmtPct(null)).toBe("—");
  });

  it("signs deltas and labels the incomparable case", () => {
    expect(fmtDelta(1.2)).toBe("+1.20%");
    expect(fmtDelta(-0.5)).toBe("-0.50%");
    expect(fmtDelta(0)).toBe("0.00%");
    expect(fmtDelta(null)).toBe("n/a");
  });
});

describe("renderComment", () => {
  const link = "https://example.test/buckets.ts";

  it("emits a no-baseline note and no diff table when nothing is cached", () => {
    const body = renderComment({
      buckets: ["unit", "integration"],
      data: {
        unit: { current: totals(8, 10), baseline: null },
        integration: { current: totals(7, 10), baseline: null },
      },
      baselineLabel: "latest `main`",
      bucketsLink: link,
    });
    expect(body).toContain("### Change vs base");
    expect(body).toContain("No baseline coverage is cached");
    expect(body).not.toContain("Δ Lines");
    // Totals section still renders below.
    expect(body.indexOf("### Change vs base")).toBeLessThan(body.indexOf("### Totals"));
  });

  it("renders the diff table but a no-comparison headline when current lcov is missing", () => {
    // Baseline cached on main, but this run produced no lcov (tests failed):
    // the comparison is impossible even though the baseline side exists.
    const body = renderComment({
      buckets: ["unit", "integration"],
      data: {
        unit: { current: null, baseline: totals(8, 10, 5, 10) },
        integration: { current: null, baseline: totals(8, 10, 5, 10) },
      },
      baselineLabel: "latest `main`",
      bucketsLink: link,
    });
    expect(body).toContain("**No comparison**");
    expect(body).toContain("one or both sides");
    // hasBaseline is true, so the diff table still renders (with n/a deltas).
    expect(body).toContain("| Bucket | Lines | Δ Lines | Functions | Δ Functions |");
    expect(body).toContain("n/a");
  });

  it("puts the verdict and diff table above the totals", () => {
    const body = renderComment({
      buckets: ["unit", "integration"],
      data: {
        unit: { current: totals(9, 10, 5, 10), baseline: totals(8, 10, 5, 10) },
        integration: { current: totals(8, 10, 5, 10), baseline: totals(8, 10, 5, 10) },
      },
      baselineLabel: "latest `main`",
      bucketsLink: link,
    });
    expect(body).toContain("**Improved**");
    expect(body).toContain("| Bucket | Lines | Δ Lines | Functions | Δ Functions |");
    expect(body).toContain("+10.00%");
    expect(body.indexOf("Δ Lines")).toBeLessThan(body.indexOf("### Totals"));
  });
});

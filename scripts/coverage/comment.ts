// Build a markdown coverage summary from coverage/<bucket>/lcov.info files and
// write it to coverage-comment.md for the sticky-comment action.
//
// When a baseline is present at baseline/<bucket>/lcov.info (restored from the
// latest `main` run via the Actions cache), the report opens with a "Change vs
// base" section that reports whether this PR improved, maintained, or worsened
// coverage, plus per-bucket deltas. Without a baseline it degrades to a note.
//
// Usage: bun scripts/coverage/comment.ts [output-path]
//        (output-path defaults to ./coverage-comment.md)

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import type { Bucket } from "./buckets";

const ROOT = resolve(import.meta.dir, "..", "..");
const BUCKETS: readonly Bucket[] = ["unit", "integration"];

export type Totals = {
  files: number;
  linesFound: number;
  linesHit: number;
  funcsFound: number;
  funcsHit: number;
};

export type Verdict = "improved" | "worsened" | "maintained" | "n/a";

export type BucketDiff = {
  lineCur: number | null;
  funcCur: number | null;
  lineDelta: number | null;
  funcDelta: number | null;
  verdict: Verdict;
};

export function parseLcov(text: string): Totals {
  const totals: Totals = {
    files: 0,
    linesFound: 0,
    linesHit: 0,
    funcsFound: 0,
    funcsHit: 0,
  };
  for (const line of text.split("\n")) {
    if (line.startsWith("SF:")) totals.files += 1;
    else if (line.startsWith("LF:")) totals.linesFound += Number(line.slice(3));
    else if (line.startsWith("LH:")) totals.linesHit += Number(line.slice(3));
    else if (line.startsWith("FNF:")) totals.funcsFound += Number(line.slice(4));
    else if (line.startsWith("FNH:")) totals.funcsHit += Number(line.slice(4));
  }
  return totals;
}

export function ratioPct(hit: number, found: number): number | null {
  return found === 0 ? null : (hit / found) * 100;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Classify a single bucket from its (already rounded) line/function deltas.
// Any regression wins (worsened); otherwise any gain is an improvement; an
// all-zero delta is "maintained"; no comparable metric at all is "n/a".
function classify(lineDelta: number | null, funcDelta: number | null): Verdict {
  const deltas = [lineDelta, funcDelta].filter((d): d is number => d !== null);
  if (deltas.length === 0) return "n/a";
  if (deltas.some((d) => d < 0)) return "worsened";
  if (deltas.some((d) => d > 0)) return "improved";
  return "maintained";
}

export function diffBucket(current: Totals | null, baseline: Totals | null): BucketDiff {
  const lineCur = current ? ratioPct(current.linesHit, current.linesFound) : null;
  const funcCur = current ? ratioPct(current.funcsHit, current.funcsFound) : null;
  const lineBase = baseline ? ratioPct(baseline.linesHit, baseline.linesFound) : null;
  const funcBase = baseline ? ratioPct(baseline.funcsHit, baseline.funcsFound) : null;
  // Compare on the 2dp values we actually render so the verdict never
  // contradicts the displayed numbers.
  const lineDelta =
    lineCur !== null && lineBase !== null ? round2(round2(lineCur) - round2(lineBase)) : null;
  const funcDelta =
    funcCur !== null && funcBase !== null ? round2(round2(funcCur) - round2(funcBase)) : null;
  return { lineCur, funcCur, lineDelta, funcDelta, verdict: classify(lineDelta, funcDelta) };
}

// Roll per-bucket verdicts into one. A regression in any bucket is a
// regression overall; otherwise any gain is an improvement.
export function overallVerdict(verdicts: readonly Verdict[]): Verdict {
  const known = verdicts.filter((v) => v !== "n/a");
  if (known.length === 0) return "n/a";
  if (known.includes("worsened")) return "worsened";
  if (known.includes("improved")) return "improved";
  return "maintained";
}

export function fmtPct(p: number | null): string {
  return p === null ? "—" : `${p.toFixed(2)}%`;
}

export function fmtDelta(d: number | null): string {
  if (d === null) return "n/a";
  if (d > 0) return `+${d.toFixed(2)}%`;
  if (d < 0) return `${d.toFixed(2)}%`;
  return "0.00%";
}

const VERDICT_HEADLINE: Record<Verdict, string> = {
  improved: "**Improved** — coverage increased relative to the base branch.",
  worsened: "**Worsened** — coverage decreased relative to the base branch.",
  maintained: "**Maintained** — coverage is unchanged relative to the base branch.",
  "n/a": "**No comparison** — coverage data was not available on both sides.",
};

export type BucketData = { current: Totals | null; baseline: Totals | null };

export type ReportInput = {
  buckets: readonly Bucket[];
  data: Record<Bucket, BucketData>;
  baselineLabel: string;
  bucketsLink: string;
};

function totalsRow(bucket: Bucket, t: Totals | null): string {
  if (!t) return `| \`${bucket}\` | — | — | — |`;
  return `| \`${bucket}\` | ${fmtPct(ratioPct(t.linesHit, t.linesFound))} (${t.linesHit} / ${t.linesFound}) | ${fmtPct(ratioPct(t.funcsHit, t.funcsFound))} (${t.funcsHit} / ${t.funcsFound}) | ${t.files} |`;
}

function diffRow(bucket: Bucket, d: BucketDiff): string {
  return `| \`${bucket}\` | ${fmtPct(d.lineCur)} | ${fmtDelta(d.lineDelta)} | ${fmtPct(d.funcCur)} | ${fmtDelta(d.funcDelta)} |`;
}

export function renderComment(input: ReportInput): string {
  const { buckets, data, baselineLabel, bucketsLink } = input;
  const hasBaseline = buckets.some((b) => data[b].baseline !== null);

  const lines: string[] = ["## Coverage report", ""];

  lines.push("### Change vs base", "");
  if (!hasBaseline) {
    lines.push(
      "No baseline coverage is cached for the base branch yet — the diff will appear once this workflow has run on `main`.",
      "",
    );
  } else {
    const diffs = buckets.map((b) => diffBucket(data[b].current, data[b].baseline));
    lines.push(
      VERDICT_HEADLINE[overallVerdict(diffs.map((d) => d.verdict))],
      "",
      "| Bucket | Lines | Δ Lines | Functions | Δ Functions |",
      "|---|---|---|---|---|",
      ...buckets.map((b, i) => diffRow(b, diffs[i])),
      "",
      `Baseline: ${baselineLabel}.`,
      "",
    );
  }

  lines.push(
    "### Totals",
    "",
    "| Bucket | Lines | Functions | Files |",
    "|---|---|---|---|",
    ...buckets.map((b) => totalsRow(b, data[b].current)),
    "",
    `Download the full reports as \`coverage-unit\` / \`coverage-integration\` artifacts on this run. Bucket definitions: [\`scripts/coverage/buckets.ts\`](${bucketsLink}).`,
    "",
  );

  return lines.join("\n");
}

function loadTotals(dir: string, bucket: Bucket): Totals | null {
  const path = resolve(ROOT, dir, bucket, "lcov.info");
  return existsSync(path) ? parseLcov(readFileSync(path, "utf8")) : null;
}

// Turn the restored cache key (coverage-baseline-<sha>) into a human label.
function baselineLabelFromKey(key: string | undefined): string {
  const sha = key?.startsWith("coverage-baseline-") ? key.slice("coverage-baseline-".length) : "";
  return sha ? `latest \`main\` (commit \`${sha.slice(0, 7)}\`)` : "latest `main`";
}

if (import.meta.main) {
  const server = process.env.GITHUB_SERVER_URL ?? "https://github.com";
  const repo = process.env.GITHUB_REPOSITORY ?? "punitarani/abadge";
  const sha = process.env.GITHUB_SHA ?? "HEAD";
  const bucketsLink = `${server}/${repo}/blob/${sha}/scripts/coverage/buckets.ts`;

  const data = Object.fromEntries(
    BUCKETS.map((bucket) => [
      bucket,
      { current: loadTotals("coverage", bucket), baseline: loadTotals("baseline", bucket) },
    ]),
  ) as Record<Bucket, BucketData>;

  const body = renderComment({
    buckets: BUCKETS,
    data,
    baselineLabel: baselineLabelFromKey(process.env.COVERAGE_BASELINE_KEY),
    bucketsLink,
  });

  const out = process.argv[2] ?? resolve(ROOT, "coverage-comment.md");
  writeFileSync(out, body);
  console.log(`coverage-comment: wrote ${out}`);
}

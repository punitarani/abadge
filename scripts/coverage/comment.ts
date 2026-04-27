// Build a markdown coverage summary from coverage/<bucket>/lcov.info files
// and write it to coverage-comment.md for the sticky-comment action.
//
// Usage: bun scripts/coverage/comment.ts [out=coverage-comment.md]

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import type { Bucket } from "./buckets";

const ROOT = resolve(import.meta.dir, "..", "..");
const BUCKETS: readonly Bucket[] = ["unit", "integration"];

type Totals = {
  files: number;
  linesFound: number;
  linesHit: number;
  funcsFound: number;
  funcsHit: number;
};

function parseLcov(text: string): Totals {
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

function pct(hit: number, found: number): string {
  if (found === 0) return "—";
  return `${((hit / found) * 100).toFixed(2)}%`;
}

function row(bucket: Bucket): string {
  const path = resolve(ROOT, "coverage", bucket, "lcov.info");
  if (!existsSync(path)) {
    return `| \`${bucket}\` | — | — | — |`;
  }
  const t = parseLcov(readFileSync(path, "utf8"));
  return `| \`${bucket}\` | ${pct(t.linesHit, t.linesFound)} (${t.linesHit} / ${t.linesFound}) | ${pct(t.funcsHit, t.funcsFound)} (${t.funcsHit} / ${t.funcsFound}) | ${t.files} |`;
}

const server = process.env.GITHUB_SERVER_URL ?? "https://github.com";
const repo = process.env.GITHUB_REPOSITORY ?? "punitarani/abadge";
const sha = process.env.GITHUB_SHA ?? "HEAD";
const bucketsLink = `${server}/${repo}/blob/${sha}/scripts/coverage/buckets.ts`;

const body = [
  "## Coverage report",
  "",
  "| Bucket | Lines | Functions | Files |",
  "|---|---|---|---|",
  ...BUCKETS.map(row),
  "",
  `Download the full reports as \`coverage-unit\` / \`coverage-integration\` artifacts on this run. Bucket definitions: [\`scripts/coverage/buckets.ts\`](${bucketsLink}).`,
  "",
].join("\n");

const out = process.argv[2] ?? resolve(ROOT, "coverage-comment.md");
writeFileSync(out, body);
console.log(`coverage-comment: wrote ${out}`);

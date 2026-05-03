// Run `bun test --coverage` for one bucket and write lcov to coverage/<bucket>/.
// Usage:
//   bun scripts/coverage/run.ts <unit|integration>
//
// Reads the glob list from ./buckets.ts (single source of truth), expands the
// globs via Bun.Glob (the bun CLI doesn't expand `**` itself when args come
// from spawn), then invokes bun with the resolved file list.

import { rmSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { BUCKETS, type Bucket } from "./buckets";

const ROOT = resolve(import.meta.dir, "..", "..");

function isBucket(value: string): value is Bucket {
  return value === "unit" || value === "integration";
}

const bucket = process.argv[2];
if (!bucket || !isBucket(bucket)) {
  console.error("Usage: bun scripts/coverage/run.ts <unit|integration>");
  process.exit(2);
}

const files = new Set<string>();
for (const pattern of BUCKETS[bucket]) {
  const glob = new Bun.Glob(pattern);
  for await (const path of glob.scan({ cwd: ROOT, onlyFiles: true })) {
    files.add(path);
  }
}

if (files.size === 0) {
  console.error(`coverage[${bucket}]: no test files matched any glob`);
  process.exit(2);
}

const fileList = Array.from(files).sort();
const coverageDir = resolve(ROOT, "coverage", bucket);
rmSync(coverageDir, { recursive: true, force: true });

const args = ["test", "--coverage", `--coverage-dir=${coverageDir}`, ...fileList];

console.log(`coverage[${bucket}]: ${fileList.length} files -> ${coverageDir}`);

const proc = Bun.spawn(["bun", ...args], {
  cwd: ROOT,
  stdio: ["inherit", "inherit", "inherit"],
});

const exitCode = await proc.exited;
process.exit(exitCode);

import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");

const readKeyFile = async (relativePath: string) => {
  const text = await Bun.file(resolve(repoRoot, relativePath)).text();
  const keys = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  expect(new Set(keys).size).toBe(keys.length);
  return new Set(keys);
};

/** String keys on Bindings (excludes HYPERDRIVE and other non-env fields). */
const readBindingsStringKeys = async () => {
  const source = await Bun.file(resolve(repoRoot, "apps/api/src/types.ts")).text();
  const match = source.match(/export type Bindings = \{([^}]+)\}/s);
  if (!match?.[1]) {
    throw new Error("Could not parse Bindings from apps/api/src/types.ts");
  }
  const keys: string[] = [];
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\??:\s*string/);
    if (m) keys.push(m[1]);
  }
  return new Set(keys);
};

describe("worker env key lists", () => {
  it("keeps worker-env-keys aligned to Bindings string keys", async () => {
    const envKeys = await readKeyFile("scripts/worker-env-keys.txt");
    const bindingKeys = await readBindingsStringKeys();
    const unknownKeys = [...envKeys].filter((key) => !bindingKeys.has(key));

    expect(unknownKeys).toEqual([]);
  });

  it("includes every Bindings string key", async () => {
    const envKeys = await readKeyFile("scripts/worker-env-keys.txt");
    const bindingKeys = await readBindingsStringKeys();
    const missing = [...bindingKeys].filter((key) => !envKeys.has(key));

    expect(missing).toEqual([]);
  });
});

#!/usr/bin/env bun
import { main } from "../src/index";

void main(process.argv.slice(2)).catch((err) => {
  console.error(err instanceof Error ? err.message : "Unexpected CLI failure");
  process.exit(1);
});

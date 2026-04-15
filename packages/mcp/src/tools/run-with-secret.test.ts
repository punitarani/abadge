import { describe, expect, test } from "bun:test";
import { MAX_OUTPUT_BYTES, PRE_REDACT_CAP_BYTES, runCommand } from "./run-with-secret";

const nodeBinary = process.execPath; // bun or node — either can run a -e script

describe("run_with_secret OOM bound", () => {
  test("drops stdout past the pre-redaction cap", async () => {
    // Emit MAX_OUTPUT_BYTES * 4 bytes (32 KB) — well past the per-stream cap (8 KB)
    const totalBytes = MAX_OUTPUT_BYTES * 4;
    const script = `
      const buf = 'A'.repeat(1024);
      const iters = ${totalBytes} / 1024;
      for (let i = 0; i < iters; i++) process.stdout.write(buf);
    `;

    const result = await runCommand(nodeBinary, ["-e", script], process.env);

    expect(result.exitCode).toBe(0);
    expect(result.stdoutTruncated).toBe(true);
    // Pre-redaction buffer must not exceed the cap.
    expect(Buffer.byteLength(result.stdout, "utf8")).toBeLessThanOrEqual(PRE_REDACT_CAP_BYTES);
  });

  test("does not OOM with ~10 MB of stdout", async () => {
    // Emit 10 MiB. With the bounded capture dropping chunks past 8 KB,
    // completion time stays short and memory stays bounded.
    const script = `
      const buf = 'B'.repeat(64 * 1024); // 64 KiB chunks
      const iters = 160; // 10 MiB total
      for (let i = 0; i < iters; i++) process.stdout.write(buf);
    `;

    const result = await runCommand(nodeBinary, ["-e", script], process.env);

    expect(result.exitCode).toBe(0);
    expect(result.stdoutTruncated).toBe(true);
    expect(Buffer.byteLength(result.stdout, "utf8")).toBeLessThanOrEqual(PRE_REDACT_CAP_BYTES);
  }, 15000);

  test("does not truncate when output fits under the cap", async () => {
    const script = `process.stdout.write('hello world');`;

    const result = await runCommand(nodeBinary, ["-e", script], process.env);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello world");
    expect(result.stdoutTruncated).toBe(false);
    expect(result.stderrTruncated).toBe(false);
  });

  test("caps stderr independently from stdout", async () => {
    const totalBytes = MAX_OUTPUT_BYTES * 4;
    const script = `
      const buf = 'E'.repeat(1024);
      const iters = ${totalBytes} / 1024;
      for (let i = 0; i < iters; i++) process.stderr.write(buf);
    `;

    const result = await runCommand(nodeBinary, ["-e", script], process.env);

    expect(result.stderrTruncated).toBe(true);
    expect(Buffer.byteLength(result.stderr, "utf8")).toBeLessThanOrEqual(PRE_REDACT_CAP_BYTES);
  });
});

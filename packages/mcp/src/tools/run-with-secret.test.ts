import { describe, expect, test } from "bun:test";
import { validateEnvVarName } from "@abadge/core";
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

describe("run_with_secret envVarName validation (W3P10-001)", () => {
  test("rejects LD_PRELOAD", () => {
    const result = validateEnvVarName("LD_PRELOAD");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toBe("reserved");
  });

  test("rejects NODE_OPTIONS", () => {
    const result = validateEnvVarName("NODE_OPTIONS");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toBe("reserved");
  });

  test("rejects BASH_ENV", () => {
    const result = validateEnvVarName("BASH_ENV");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toBe("reserved");
  });

  test("rejects DYLD_INSERT_LIBRARIES", () => {
    const result = validateEnvVarName("DYLD_INSERT_LIBRARIES");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toBe("reserved");
  });

  test("accepts ABADGE_SECRET (default)", () => {
    const result = validateEnvVarName("ABADGE_SECRET");
    expect(result.ok).toBe(true);
  });

  test("accepts custom MY_API_KEY", () => {
    const result = validateEnvVarName("MY_API_KEY");
    expect(result.ok).toBe(true);
  });

  test("accepts names starting with underscore (POSIX-valid)", () => {
    const result = validateEnvVarName("_MY_VAR");
    expect(result.ok).toBe(true);
  });

  test("rejects lowercase env var names", () => {
    const result = validateEnvVarName("my_secret");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toBe("invalid_format");
  });

  test("rejects empty-string envVarName", () => {
    const result = validateEnvVarName("");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toBe("invalid_format");
  });

  test("rejects names starting with a digit", () => {
    const result = validateEnvVarName("1SECRET");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toBe("invalid_format");
  });
});

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { validateEnvVarName } from "@abadge/core";
import * as apiClientModule from "../api-client.js";
import * as resolveSecretModule from "../resolve-secret.js";
import { handler, MAX_OUTPUT_BYTES, STREAM_CAP_BYTES, runCommand } from "./run-with-secret";

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
    expect(Buffer.byteLength(result.stdout, "utf8")).toBeLessThanOrEqual(STREAM_CAP_BYTES);
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
    expect(Buffer.byteLength(result.stdout, "utf8")).toBeLessThanOrEqual(STREAM_CAP_BYTES);
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
    expect(Buffer.byteLength(result.stderr, "utf8")).toBeLessThanOrEqual(STREAM_CAP_BYTES);
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

/**
 * Tests for W3P4-001 (Task B1, Critical C-1): run_with_secret must refuse
 * secrets whose byte length exceeds MAX_OUTPUT_BYTES. The in-process redactor
 * can only guarantee scrubbing when the full secret fits in the 8KB
 * STREAM_CAP_BYTES capture window; large secrets must route to
 * mount_secret (filesystem delivery, no redaction required).
 */
describe("handler secret size guard — W3P4-001", () => {
  const fakeClient = {} as never;
  const fakeConfig = {
    apiUrl: "http://localhost",
    agentId: "agent_test",
    privateKey: "{}",
  } as never;

  test("rejects secret larger than MAX_OUTPUT_BYTES (9KB)", async () => {
    const largeSecret = "A".repeat(9000);
    const clientSpy = spyOn(apiClientModule, "getApiClient").mockResolvedValue(fakeClient);
    const secretSpy = spyOn(resolveSecretModule, "resolveSecret").mockResolvedValue(largeSecret);

    await expect(
      handler({ itemId: "item_test", command: "echo", envVarName: "ABADGE_SECRET" }, fakeConfig),
    ).rejects.toThrow(/Secret is 9000 bytes|can only safely handle secrets/);

    clientSpy.mockRestore();
    secretSpy.mockRestore();
  });

  test("rejects secret at MAX_OUTPUT_BYTES + 1 (boundary: just over)", async () => {
    const justOverSecret = "A".repeat(MAX_OUTPUT_BYTES + 1);
    const clientSpy = spyOn(apiClientModule, "getApiClient").mockResolvedValue(fakeClient);
    const secretSpy = spyOn(resolveSecretModule, "resolveSecret").mockResolvedValue(justOverSecret);

    await expect(handler({ itemId: "item_test", command: "echo" }, fakeConfig)).rejects.toThrow(
      /Secret is \d+ bytes/,
    );

    clientSpy.mockRestore();
    secretSpy.mockRestore();
  });

  test("accepts secret at exactly MAX_OUTPUT_BYTES (boundary: at limit)", async () => {
    const boundarySecret = "A".repeat(MAX_OUTPUT_BYTES);
    const clientSpy = spyOn(apiClientModule, "getApiClient").mockResolvedValue(fakeClient);
    const secretSpy = spyOn(resolveSecretModule, "resolveSecret").mockResolvedValue(boundarySecret);

    // handler should NOT throw — it should proceed to spawn. The spawn call will
    // run /usr/bin/true (or equivalent) which exits cleanly with no output.
    const result = await handler(
      { itemId: "item_test", command: process.execPath, args: ["-e", "process.exit(0)"] },
      fakeConfig,
    );
    const parsed = JSON.parse(result);
    expect(parsed.exitCode).toBe(0);

    clientSpy.mockRestore();
    secretSpy.mockRestore();
  });

  /**
   * Critical discrimination test: simulate the actual exploit.
   * A PEM-shaped 9KB secret — exactly the class of credential that matters
   * operationally (SSH keys, kubeconfigs, TLS certs). The handler must throw
   * BEFORE spawn — no subprocess runs, no plaintext is captured.
   *
   * The throw IS the proof: if the handler returned a value instead of
   * throwing, this test would fail, exposing the original vulnerability.
   */
  test("9KB PEM-shaped secret rejected before spawn — no plaintext reaches LLM (W3P4-001 discrimination)", async () => {
    const pemLikeSecret =
      "-----BEGIN PRIVATE KEY-----\n" + "A".repeat(8500) + "\n-----END PRIVATE KEY-----\n";
    const clientSpy = spyOn(apiClientModule, "getApiClient").mockResolvedValue(fakeClient);
    const secretSpy = spyOn(resolveSecretModule, "resolveSecret").mockResolvedValue(pemLikeSecret);

    // The handler must throw before spawn. If it returns a JSON string
    // (success path), the original exploit is still present.
    await expect(
      handler(
        {
          itemId: "item_test",
          command: process.execPath,
          args: ["-e", 'process.stdout.write(process.env.ABADGE_SECRET ?? "")'],
        },
        fakeConfig,
      ),
    ).rejects.toThrow(/Secret is \d+ bytes|can only safely handle secrets/);

    // Since the handler threw, no subprocess was spawned and no plaintext
    // was captured. The throw is the security guarantee.
    clientSpy.mockRestore();
    secretSpy.mockRestore();
  });
});

/**
 * Integration tests that call handler() directly with mocked dependencies.
 * These tests prove the guard inside handler() is exercised — stashing the
 * validateEnvVarName call in run-with-secret.ts makes these tests fail even
 * though the pure-function tests above would still pass (W3P10-001 regression
 * proof).
 */
describe("handler envVarName guard — integration (W3P10-001)", () => {
  // Stub getApiClient and resolveSecret so handler reaches the validation code
  // without needing a live API server or daemon.
  const fakeClient = {} as never;
  const fakeConfig = {
    apiUrl: "http://localhost",
    agentId: "agent_test",
    privateKey: "{}",
  } as never;

  afterEach(() => {
    // Restore spies to avoid bleeding between tests
  });

  test("handler rejects LD_PRELOAD before spawning (reserved key)", async () => {
    const clientSpy = spyOn(apiClientModule, "getApiClient").mockResolvedValue(fakeClient);
    const secretSpy = spyOn(resolveSecretModule, "resolveSecret").mockResolvedValue("mysecret");

    await expect(
      handler(
        { itemId: "item_1", command: "echo", args: [], envVarName: "LD_PRELOAD" },
        fakeConfig,
      ),
    ).rejects.toThrow(/reserved env var/i);

    clientSpy.mockRestore();
    secretSpy.mockRestore();
  });

  test("handler rejects NODE_OPTIONS before spawning (reserved key)", async () => {
    const clientSpy = spyOn(apiClientModule, "getApiClient").mockResolvedValue(fakeClient);
    const secretSpy = spyOn(resolveSecretModule, "resolveSecret").mockResolvedValue("mysecret");

    await expect(
      handler(
        { itemId: "item_1", command: "echo", args: [], envVarName: "NODE_OPTIONS" },
        fakeConfig,
      ),
    ).rejects.toThrow(/reserved env var/i);

    clientSpy.mockRestore();
    secretSpy.mockRestore();
  });

  test("handler rejects invalid format (lowercase key)", async () => {
    const clientSpy = spyOn(apiClientModule, "getApiClient").mockResolvedValue(fakeClient);
    const secretSpy = spyOn(resolveSecretModule, "resolveSecret").mockResolvedValue("mysecret");

    await expect(
      handler({ itemId: "item_1", command: "echo", args: [], envVarName: "bad_key" }, fakeConfig),
    ).rejects.toThrow(/Invalid env var name/i);

    clientSpy.mockRestore();
    secretSpy.mockRestore();
  });
});

/**
 * §RED1 — response shape tests.
 *
 * String-based redaction had 14+ bypass vectors (base64, hex, URL-encoded,
 * emoji cipher, nth-char extraction, byte-split across cap, etc.). The fix
 * is to stop piping subprocess output to the LLM entirely. These tests assert
 * the new contract: response keys = { exitCode, durationMs, outputLineCount,
 * truncated } — never stdoutLines or stderrLines.
 */
describe("handler response shape — §RED1", () => {
  const fakeClient = {} as never;
  const fakeConfig = {
    apiUrl: "http://localhost",
    agentId: "agent_test",
    privateKey: "{}",
  } as never;

  test("response does NOT contain stdoutLines or stderrLines (§RED1)", async () => {
    const clientSpy = spyOn(apiClientModule, "getApiClient").mockResolvedValue(fakeClient);
    // Secret that a subprocess might emit in various encoded forms — the whole
    // point is that even if the subprocess leaks, the JSON response has no
    // field where that leakage can land.
    const secret = "supersecret";
    const secretSpy = spyOn(resolveSecretModule, "resolveSecret").mockResolvedValue(secret);

    const result = await handler(
      {
        itemId: "item_test",
        command: process.execPath,
        args: ["-e", `process.stdout.write(process.env.ABADGE_SECRET ?? "")`],
      },
      fakeConfig,
    );
    const parsed = JSON.parse(result);
    expect("stdoutLines" in parsed).toBe(false);
    expect("stderrLines" in parsed).toBe(false);
    expect(typeof parsed.exitCode).toBe("number");
    expect(typeof parsed.durationMs).toBe("number");
    expect(typeof parsed.outputLineCount.stdout).toBe("number");
    expect(typeof parsed.outputLineCount.stderr).toBe("number");

    clientSpy.mockRestore();
    secretSpy.mockRestore();
  });

  test("response structure: exactly exitCode + durationMs + outputLineCount + truncated", async () => {
    const clientSpy = spyOn(apiClientModule, "getApiClient").mockResolvedValue(fakeClient);
    const secretSpy = spyOn(resolveSecretModule, "resolveSecret").mockResolvedValue("mysecret");

    const result = await handler(
      { itemId: "item_test", command: process.execPath, args: ["-e", "process.exit(0)"] },
      fakeConfig,
    );
    const parsed = JSON.parse(result);
    const keys = Object.keys(parsed).sort();
    expect(keys).toEqual(["durationMs", "exitCode", "outputLineCount", "truncated"]);

    clientSpy.mockRestore();
    secretSpy.mockRestore();
  });

  test("outputLineCount reflects actual stdout line count", async () => {
    const clientSpy = spyOn(apiClientModule, "getApiClient").mockResolvedValue(fakeClient);
    const secretSpy = spyOn(resolveSecretModule, "resolveSecret").mockResolvedValue("mysecret");

    // Emit exactly 3 lines; countLines("line1\nline2\nline3\n") = 4 (trailing \n adds empty string)
    const result = await handler(
      {
        itemId: "item_test",
        command: process.execPath,
        args: ["-e", 'process.stdout.write("line1\\nline2\\nline3\\n")'],
      },
      fakeConfig,
    );
    const parsed = JSON.parse(result);
    expect(parsed.outputLineCount.stdout).toBeGreaterThanOrEqual(3);
    expect(parsed.outputLineCount.stderr).toBe(0);
    expect(parsed.exitCode).toBe(0);

    clientSpy.mockRestore();
    secretSpy.mockRestore();
  });

  test("secret emitted in base64 by subprocess does not appear in response", async () => {
    const clientSpy = spyOn(apiClientModule, "getApiClient").mockResolvedValue(fakeClient);
    const secret = "mysupersecret";
    const secretSpy = spyOn(resolveSecretModule, "resolveSecret").mockResolvedValue(secret);

    // Subprocess echoes the secret base64-encoded — a classic bypass for
    // string-based redactors. The response must have no text fields at all.
    const result = await handler(
      {
        itemId: "item_test",
        command: process.execPath,
        args: [
          "-e",
          `process.stdout.write(Buffer.from(process.env.ABADGE_SECRET ?? "").toString("base64"))`,
        ],
      },
      fakeConfig,
    );
    const parsed = JSON.parse(result);
    // The JSON string must not contain the secret or its base64 form.
    const base64Secret = Buffer.from(secret).toString("base64");
    expect(result).not.toContain(secret);
    expect(result).not.toContain(base64Secret);
    // Only these four keys must be present.
    expect(Object.keys(parsed).sort()).toEqual(["durationMs", "exitCode", "outputLineCount", "truncated"]);

    clientSpy.mockRestore();
    secretSpy.mockRestore();
  });
});

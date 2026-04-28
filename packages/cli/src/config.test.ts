/**
 * Unit coverage for ~/.abadge/config.json — load/save/update/clear, legacy
 * field stripping, daemon fingerprint pinning.
 *
 * The config module resolves CONFIG_DIR from os.homedir() at import time, so
 * we set process.env.HOME to a tmpdir BEFORE the dynamic import. Each test
 * resets state by calling clearConfig() rather than re-mounting HOME.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearConfig,
  loadConfig,
  readPinnedDaemonFingerprint,
  requireActiveOrgId,
  requireConfig,
  saveConfig,
  updateConfig,
  writePinnedDaemonFingerprint,
} from "./config";

// config.ts now resolves $HOME at call time (see getConfigDir/getConfigPath),
// so a per-test tmpdir override via process.env.HOME is enough — no module
// mocking required, and parallel test files don't conflict.
const HOME_DIR = mkdtempSync(join(tmpdir(), "abadge-cfg-"));
const cfgPath = join(HOME_DIR, ".abadge", "config.json");
const cfgDir = join(HOME_DIR, ".abadge");
const ORIGINAL_HOME = process.env.HOME;

let warnSpy: ReturnType<typeof spyOn>;

beforeAll(() => {
  process.env.HOME = HOME_DIR;
  expect(existsSync(HOME_DIR)).toBe(true);
});

afterAll(() => {
  if (ORIGINAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIGINAL_HOME;
  rmSync(HOME_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  // Reassert HOME in case a parallel test file mutated it.
  process.env.HOME = HOME_DIR;
  warnSpy = spyOn(console, "warn").mockImplementation(() => undefined);
  rmSync(cfgDir, { recursive: true, force: true });
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe("loadConfig / saveConfig", () => {
  test("returns null when no config file exists", () => {
    expect(loadConfig()).toBeNull();
  });

  test("returns null when JSON is malformed (does not throw)", () => {
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(cfgPath, "{ not valid json", { mode: 0o600 });
    expect(loadConfig()).toBeNull();
  });

  test("saveConfig roundtrips apiUrl + activeOrgId + activeProfileId", () => {
    saveConfig({
      apiUrl: "http://localhost:8787",
      activeOrgId: "org_1",
      activeProfileId: "prof_1",
    });
    const loaded = loadConfig();
    expect(loaded).toEqual({
      apiUrl: "http://localhost:8787",
      activeOrgId: "org_1",
      activeProfileId: "prof_1",
      localAgents: undefined,
      daemonFingerprint: undefined,
    });
  });

  test("writes config with mode 0o600 and dir 0o700", () => {
    saveConfig({ apiUrl: "http://localhost:8787" });
    const fileMode = statSync(cfgPath).mode & 0o777;
    const dirMode = statSync(cfgDir).mode & 0o777;
    expect(fileMode).toBe(0o600);
    expect(dirMode).toBe(0o700);
  });

  test("saveConfig rejects when apiUrl is missing", () => {
    expect(() => saveConfig({} as unknown as { apiUrl: string })).toThrow(/apiUrl is required/);
  });

  test("strips legacy principalId/principalSecret/operatorUserId/authToken on load", () => {
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      cfgPath,
      JSON.stringify({
        apiUrl: "http://x",
        principalId: "p_1",
        principalSecret: "secret",
        operatorUserId: "u_1",
        authToken: "tok",
        activeOrgId: "org_1",
      }),
      { mode: 0o600 },
    );

    const loaded = loadConfig();
    expect(loaded?.apiUrl).toBe("http://x");
    expect(loaded?.activeOrgId).toBe("org_1");

    // After load the file is rewritten without legacy fields.
    const persisted = JSON.parse(readFileSync(cfgPath, "utf-8"));
    expect(persisted).not.toHaveProperty("principalId");
    expect(persisted).not.toHaveProperty("principalSecret");
    expect(persisted).not.toHaveProperty("operatorUserId");
    expect(persisted).not.toHaveProperty("authToken");
    expect(warnSpy).toHaveBeenCalled();
  });

  test("loadConfig returns null when apiUrl is missing or empty", () => {
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(cfgPath, JSON.stringify({ apiUrl: "" }), { mode: 0o600 });
    expect(loadConfig()).toBeNull();
  });
});

describe("updateConfig", () => {
  test("merges patch over existing config and saves", () => {
    saveConfig({ apiUrl: "http://x", activeOrgId: "org_1" });
    updateConfig({ activeProfileId: "prof_1" });
    const loaded = loadConfig();
    expect(loaded?.apiUrl).toBe("http://x");
    expect(loaded?.activeOrgId).toBe("org_1");
    expect(loaded?.activeProfileId).toBe("prof_1");
  });

  test("works as create when no existing config", () => {
    updateConfig({ apiUrl: "http://y" });
    expect(loadConfig()?.apiUrl).toBe("http://y");
  });

  test("clearing activeProfileId via patch leaves apiUrl intact", () => {
    saveConfig({ apiUrl: "http://x", activeProfileId: "prof_1" });
    updateConfig({ activeProfileId: undefined });
    const loaded = loadConfig();
    expect(loaded?.apiUrl).toBe("http://x");
    expect(loaded?.activeProfileId).toBeUndefined();
  });
});

describe("clearConfig", () => {
  test("removes the config file", () => {
    saveConfig({ apiUrl: "http://x" });
    expect(existsSync(cfgPath)).toBe(true);
    clearConfig();
    expect(existsSync(cfgPath)).toBe(false);
  });

  test("is silent when no file exists", () => {
    expect(() => clearConfig()).not.toThrow();
  });
});

describe("requireConfig / requireActiveOrgId", () => {
  let exitCode: number | null = null;
  let errSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    exitCode = null;
    errSpy = spyOn(console, "error").mockImplementation(() => undefined);
    exitSpy = spyOn(process, "exit").mockImplementation(((code: number) => {
      exitCode = code;
      throw new Error(`__exit_${code}`);
    }) as unknown as typeof process.exit);
  });

  afterEach(() => {
    errSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("requireConfig exits with code 1 when no config", () => {
    expect(() => requireConfig()).toThrow("__exit_1");
    expect(exitCode).toBe(1);
    expect(errSpy).toHaveBeenCalled();
  });

  test("requireConfig returns the config when present", () => {
    saveConfig({ apiUrl: "http://x" });
    const c = requireConfig();
    expect(c.apiUrl).toBe("http://x");
  });

  test("requireActiveOrgId exits with code 1 when no activeOrgId", () => {
    saveConfig({ apiUrl: "http://x" });
    expect(() => requireActiveOrgId()).toThrow("__exit_1");
    expect(exitCode).toBe(1);
  });

  test("requireActiveOrgId returns the orgId when set", () => {
    saveConfig({ apiUrl: "http://x", activeOrgId: "org_1" });
    expect(requireActiveOrgId()).toBe("org_1");
  });
});

describe("daemon fingerprint pinning", () => {
  test("readPinnedDaemonFingerprint returns null when no config", async () => {
    expect(await readPinnedDaemonFingerprint()).toBeNull();
  });

  test("creates config when none exists, given a fallback url", async () => {
    await writePinnedDaemonFingerprint("fp_abc", "http://localhost:8787");
    const c = loadConfig();
    expect(c?.apiUrl).toBe("http://localhost:8787");
    expect(c?.daemonFingerprint).toBe("fp_abc");
  });

  test("persists fp on existing config", async () => {
    saveConfig({ apiUrl: "http://x" });
    await writePinnedDaemonFingerprint("fp_xyz");
    expect(loadConfig()?.daemonFingerprint).toBe("fp_xyz");
  });

  test("without fallback url is a no-op when no config exists", async () => {
    await writePinnedDaemonFingerprint("fp_xyz");
    expect(loadConfig()).toBeNull();
  });

  test("returns the persisted value", async () => {
    saveConfig({ apiUrl: "http://x", daemonFingerprint: "fp_persisted" });
    expect(await readPinnedDaemonFingerprint()).toBe("fp_persisted");
  });
});

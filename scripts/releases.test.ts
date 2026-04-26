import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import {
  isInitial0xPatchTrain,
  type ParsedChangeset,
  validateChangesetsForInitial0xPatchTrain,
  validateChangesetsTargetReleasePackages,
} from "./releases/check-changeset";
import {
  buildGitHubBinaryAssetBaseName,
  buildGitHubBinaryTag,
  defaultOutDirForPackage,
} from "./releases/publish";
import {
  getImpactedReleasePackages,
  getReleasePackage,
  releasePackages,
  repoRoot,
  validateReleaseRegistry,
} from "./releases/registry";

const cliReleasePackage = getReleasePackage("cli");
const cliBinaryTarget = cliReleasePackage.targets[0];
const mcpReleasePackage = getReleasePackage("mcp");
const mcpBinaryTarget = mcpReleasePackage.targets[0];

function runInstallerFunction(command: string, env: Record<string, string> = {}): string {
  const mergedEnv = Object.fromEntries(
    Object.entries({ ...process.env, ...env }).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const proc = Bun.spawnSync(
    ["bash", "-lc", `source "${join(repoRoot, "install.sh")}"; ${command}`],
    {
      cwd: repoRoot,
      env: mergedEnv,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const decoder = new TextDecoder();

  if (proc.exitCode !== 0) {
    throw new Error(decoder.decode(proc.stderr) || `Installer command failed: ${command}`);
  }

  return decoder.decode(proc.stdout).trim();
}

function mergedStringEnv(env: Record<string, string> = {}): Record<string, string> {
  return Object.fromEntries(
    Object.entries({ ...process.env, ...env }).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

describe("release registry", () => {
  test("registry configuration is valid", () => {
    expect(validateReleaseRegistry()).toEqual([]);
  });

  test("only explicit release packages are publishable", () => {
    expect(releasePackages.map((pkg) => pkg.packageName)).toContain("@abadge/cli");
    expect(releasePackages.map((pkg) => pkg.packageName)).toContain("@abadge/mcp");
    expect(releasePackages.map((pkg) => pkg.packageName)).not.toContain("@abadge/sdk");
  });

  test("release-surface matching includes shared release infrastructure for every package", () => {
    const impactedPackages = getImpactedReleasePackages(["scripts/releases/publish.ts"]);
    expect(impactedPackages.map((pkg) => pkg.id)).toEqual(["cli", "mcp"]);
  });

  test("sdk changes are release-surface for every binary that bundles the sdk", () => {
    const impactedPackages = getImpactedReleasePackages(["packages/sdk/src/client.ts"]);
    expect(impactedPackages.map((pkg) => pkg.id)).toEqual(["cli", "mcp"]);
  });

  test("mcp-only changes are scoped to the mcp release package", () => {
    const impactedPackages = getImpactedReleasePackages(["packages/mcp/src/server.ts"]);
    expect(impactedPackages.map((pkg) => pkg.id)).toEqual(["mcp"]);
  });

  test("cli-only changes are scoped to the cli release package", () => {
    const impactedPackages = getImpactedReleasePackages(["packages/cli/src/commands/login.ts"]);
    expect(impactedPackages.map((pkg) => pkg.id)).toEqual(["cli"]);
  });
});

describe("github binary naming", () => {
  test("cli releases use package-scoped tags and asset names", () => {
    expect(buildGitHubBinaryTag(cliBinaryTarget, "1.2.3")).toBe("cli-v1.2.3");
    expect(buildGitHubBinaryAssetBaseName(cliBinaryTarget, "1.2.3", "darwin-arm64")).toBe(
      "abadge-cli-v1.2.3-darwin-arm64",
    );
    expect(buildGitHubBinaryAssetBaseName(cliBinaryTarget, "1.2.3", "linux-arm64-baseline")).toBe(
      "abadge-cli-v1.2.3-linux-arm64-baseline",
    );
  });

  test("mcp releases use package-scoped tags and asset names", () => {
    expect(buildGitHubBinaryTag(mcpBinaryTarget, "0.0.2")).toBe("mcp-v0.0.2");
    expect(buildGitHubBinaryAssetBaseName(mcpBinaryTarget, "0.0.2", "darwin-arm64")).toBe(
      "abadge-mcp-v0.0.2-darwin-arm64",
    );
    expect(buildGitHubBinaryAssetBaseName(mcpBinaryTarget, "0.0.2", "linux-arm64-baseline")).toBe(
      "abadge-mcp-v0.0.2-linux-arm64-baseline",
    );
  });

  test("default outdir is package-scoped", () => {
    expect(defaultOutDirForPackage(cliReleasePackage, "1.2.3")).toBe(
      join(repoRoot, "dist", "releases", "cli", "1.2.3"),
    );
    expect(defaultOutDirForPackage(mcpReleasePackage, "0.0.2")).toBe(
      join(repoRoot, "dist", "releases", "mcp", "0.0.2"),
    );
  });
});

describe("changeset validation", () => {
  function changeset(path: string, releases: ParsedChangeset["releases"]): ParsedChangeset {
    return { path, releases };
  }

  test("rejects non-patch changesets while a release package is on 0.0.x", () => {
    expect(
      validateChangesetsForInitial0xPatchTrain(
        [changeset(".changeset/example.md", [{ name: "@abadge/cli", type: "minor" }])],
        cliReleasePackage,
        "0.0.1",
      ),
    ).toEqual([
      ".changeset/example.md: @abadge/cli is currently 0.0.1, so it must use a patch changeset until we intentionally leave the 0.0.x train. Replace minor with patch.",
    ]);
  });

  test("allows patch changesets on 0.0.x and minor changesets after 0.0.x", () => {
    expect(
      validateChangesetsForInitial0xPatchTrain(
        [changeset(".changeset/patch.md", [{ name: "@abadge/cli", type: "patch" }])],
        cliReleasePackage,
        "0.0.2",
      ),
    ).toEqual([]);
    expect(
      validateChangesetsForInitial0xPatchTrain(
        [changeset(".changeset/minor.md", [{ name: "@abadge/cli", type: "minor" }])],
        cliReleasePackage,
        "0.1.0",
      ),
    ).toEqual([]);
  });

  test("patch-train validation ignores changesets that do not target the active release package", () => {
    expect(
      validateChangesetsForInitial0xPatchTrain(
        [changeset(".changeset/sdk.md", [{ name: "@abadge/sdk", type: "minor" }])],
        cliReleasePackage,
        "0.0.1",
      ),
    ).toEqual([]);
  });

  test("detects the initial 0.0.x patch train from semver versions", () => {
    expect(isInitial0xPatchTrain("0.0.1")).toBe(true);
    expect(isInitial0xPatchTrain("0.0.2")).toBe(true);
    expect(isInitial0xPatchTrain("0.1.0")).toBe(false);
  });

  test("rejects changesets for packages outside the release registry", () => {
    expect(
      validateChangesetsTargetReleasePackages([
        changeset(".changeset/sdk.md", [{ name: "@abadge/sdk", type: "minor" }]),
      ]),
    ).toEqual([
      ".changeset/sdk.md: @abadge/sdk is not a release-managed package. Add it to scripts/releases/registry.ts before creating changesets for it.",
    ]);
  });

  test("allows changesets for packages that are in the release registry", () => {
    expect(
      validateChangesetsTargetReleasePackages([
        changeset(".changeset/cli.md", [{ name: "@abadge/cli", type: "patch" }]),
      ]),
    ).toEqual([]);
    expect(
      validateChangesetsTargetReleasePackages([
        changeset(".changeset/mcp.md", [{ name: "@abadge/mcp", type: "patch" }]),
      ]),
    ).toEqual([]);
  });

  test("rejects non-patch changesets while mcp is on 0.0.x", () => {
    expect(
      validateChangesetsForInitial0xPatchTrain(
        [changeset(".changeset/example.md", [{ name: "@abadge/mcp", type: "minor" }])],
        mcpReleasePackage,
        "0.0.1",
      ),
    ).toEqual([
      ".changeset/example.md: @abadge/mcp is currently 0.0.1, so it must use a patch changeset until we intentionally leave the 0.0.x train. Replace minor with patch.",
    ]);
  });
});

describe("installer helpers", () => {
  test("plain semver versions map to package-scoped tags", () => {
    expect(runInstallerFunction('release_tag_for_version cli "1.2.3"')).toBe("cli-v1.2.3");
    expect(runInstallerFunction('release_tag_for_version mcp "0.0.2"')).toBe("mcp-v0.0.2");
  });

  test("latest version per package picks the newest stable tag for that prefix", () => {
    const releasesJson = JSON.stringify([
      { tag_name: "sdk-v9.9.9" },
      { tag_name: "cli-v1.2.3" },
      { tag_name: "cli-v1.10.0" },
      { tag_name: "cli-v2.0.0-rc.1" },
      { tag_name: "mcp-v0.0.1" },
      { tag_name: "mcp-v0.0.5" },
      { tag_name: "mcp-v0.0.5-rc.1" },
    ]);

    expect(
      runInstallerFunction('latest_version_from_releases_json cli "$RELEASES_JSON"', {
        RELEASES_JSON: releasesJson,
      }),
    ).toBe("1.10.0");
    expect(
      runInstallerFunction('latest_version_from_releases_json mcp "$RELEASES_JSON"', {
        RELEASES_JSON: releasesJson,
      }),
    ).toBe("0.0.5");
  });

  test("latest version returns empty cleanly when no matching tag exists", () => {
    expect(runInstallerFunction('latest_version_from_releases_json mcp "[]"')).toBe("");
    expect(
      runInstallerFunction('latest_version_from_releases_json mcp "$RELEASES_JSON"', {
        RELEASES_JSON: JSON.stringify([{ tag_name: "cli-v1.2.3" }]),
      }),
    ).toBe("");
  });

  test("asset naming uses package-scoped prefixes", () => {
    expect(
      runInstallerFunction(
        'asset_archive_name_for_version_target cli "1.2.3" "linux-x64-baseline"',
      ),
    ).toBe("abadge-cli-v1.2.3-linux-x64-baseline.tar.gz");
    expect(
      runInstallerFunction('asset_archive_name_for_version_target mcp "0.0.2" "darwin-arm64"'),
    ).toBe("abadge-mcp-v0.0.2-darwin-arm64.tar.gz");
  });

  test("ABADGE_VERSION is rejected when installing multiple packages", () => {
    const installProc = Bun.spawnSync(
      ["bash", "-lc", `cat "${join(repoRoot, "install.sh")}" | bash`],
      {
        cwd: repoRoot,
        env: mergedStringEnv({
          ABADGE_INSTALL_PACKAGE: "all",
          ABADGE_VERSION: "1.2.3",
        }),
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const decoder = new TextDecoder();
    expect(installProc.exitCode).not.toBe(0);
    expect(decoder.decode(installProc.stderr)).toContain(
      "ABADGE_VERSION is ambiguous when installing multiple packages",
    );
  });

  test("stdin execution installs the CLI without tripping over BASH_SOURCE", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "abadge-install-test-"));

    try {
      const version = "1.2.3";
      const assetTarget = runInstallerFunction("detect_asset_target");
      const assetBaseName = runInstallerFunction(
        `asset_base_name_for_version_target cli "${version}" "${assetTarget}"`,
      );
      const assetArchiveName = runInstallerFunction(
        `asset_archive_name_for_version_target cli "${version}" "${assetTarget}"`,
      );
      const assetDir = join(tempRoot, assetBaseName);
      const binaryPath = join(assetDir, "abadge");
      const archivePath = join(tempRoot, assetArchiveName);
      const installDir = join(tempRoot, "bin");

      mkdirSync(assetDir, { recursive: true });
      mkdirSync(installDir, { recursive: true });
      writeFileSync(binaryPath, "#!/usr/bin/env bash\necho abadge-test-build\n");
      chmodSync(binaryPath, 0o755);

      const tarProc = Bun.spawnSync(["tar", "-czf", archivePath, "-C", tempRoot, assetBaseName], {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
      });
      const decoder = new TextDecoder();
      expect(tarProc.exitCode).toBe(0);

      const checksum = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
      writeFileSync(join(tempRoot, "SHA256SUMS"), `${checksum}  ${assetArchiveName}\n`);

      const installProc = Bun.spawnSync(
        ["bash", "-lc", `cat "${join(repoRoot, "install.sh")}" | bash`],
        {
          cwd: repoRoot,
          env: mergedStringEnv({
            ABADGE_INSTALL_BASE_URL: `file://${tempRoot}`,
            ABADGE_INSTALL_DIR: installDir,
            ABADGE_INSTALL_PACKAGE: "cli",
            ABADGE_VERSION: version,
            PATH: `${installDir}:${process.env.PATH ?? ""}`,
          }),
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      expect(installProc.exitCode).toBe(0);
      expect(decoder.decode(installProc.stderr)).toBe("");
      expect(readFileSync(join(installDir, "abadge"), "utf8")).toContain("abadge-test-build");

      const installedBinaryProc = Bun.spawnSync([join(installDir, "abadge")], {
        cwd: repoRoot,
        env: mergedStringEnv(),
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(installedBinaryProc.exitCode).toBe(0);
      expect(decoder.decode(installedBinaryProc.stdout).trim()).toBe("abadge-test-build");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("ABADGE_INSTALL_PACKAGE=all skips packages with no published release instead of failing", () => {
    // Reproduces the time window between the feature-PR merge (when this
    // install.sh is live on main) and the version-PR merge (when the first
    // mcp-v* tag is published). During that window, `curl|bash` with the
    // default `all` would die on a missing mcp tag if it hard-failed; instead
    // we want it to install whatever is available and warn about the rest.
    const tempRoot = mkdtempSync(join(tmpdir(), "abadge-install-skip-test-"));

    try {
      const cliVersion = "1.2.3";
      const assetTarget = runInstallerFunction("detect_asset_target");
      const cliBaseName = runInstallerFunction(
        `asset_base_name_for_version_target cli "${cliVersion}" "${assetTarget}"`,
      );
      const cliArchiveName = runInstallerFunction(
        `asset_archive_name_for_version_target cli "${cliVersion}" "${assetTarget}"`,
      );
      const cliAssetDir = join(tempRoot, cliBaseName);
      const cliBinaryPath = join(cliAssetDir, "abadge");
      const cliArchivePath = join(tempRoot, cliArchiveName);
      const installDir = join(tempRoot, "bin");

      mkdirSync(cliAssetDir, { recursive: true });
      mkdirSync(installDir, { recursive: true });
      writeFileSync(cliBinaryPath, "#!/usr/bin/env bash\necho abadge-skip-test\n");
      chmodSync(cliBinaryPath, 0o755);

      const tarProc = Bun.spawnSync(["tar", "-czf", cliArchivePath, "-C", tempRoot, cliBaseName], {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
      });
      const decoder = new TextDecoder();
      expect(tarProc.exitCode).toBe(0);

      const cliChecksum = createHash("sha256").update(readFileSync(cliArchivePath)).digest("hex");
      writeFileSync(join(tempRoot, "SHA256SUMS"), `${cliChecksum}  ${cliArchiveName}\n`);

      // Default INSTALL_PACKAGE=all, only CLI has a release. MCP must be
      // skipped (warn-and-continue) so the CLI install still succeeds.
      const installProc = Bun.spawnSync(
        ["bash", "-lc", `cat "${join(repoRoot, "install.sh")}" | bash`],
        {
          cwd: repoRoot,
          env: mergedStringEnv({
            ABADGE_INSTALL_BASE_URL: `file://${tempRoot}`,
            ABADGE_INSTALL_DIR: installDir,
            ABADGE_INSTALL_PACKAGE: "all",
            ABADGE_CLI_VERSION: cliVersion,
            PATH: `${installDir}:${process.env.PATH ?? ""}`,
          }),
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      expect(installProc.exitCode).toBe(0);
      const stdout = decoder.decode(installProc.stdout);
      expect(stdout).toContain("Installed abadge to");
      expect(stdout).toMatch(/No release found for abadge MCP server.*skipping/);
      expect(readFileSync(join(installDir, "abadge"), "utf8")).toContain("abadge-skip-test");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("stdin execution installs the MCP binary when ABADGE_INSTALL_PACKAGE=mcp", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "abadge-install-mcp-test-"));

    try {
      const version = "0.0.2";
      const assetTarget = runInstallerFunction("detect_asset_target");
      const assetBaseName = runInstallerFunction(
        `asset_base_name_for_version_target mcp "${version}" "${assetTarget}"`,
      );
      const assetArchiveName = runInstallerFunction(
        `asset_archive_name_for_version_target mcp "${version}" "${assetTarget}"`,
      );
      const assetDir = join(tempRoot, assetBaseName);
      const binaryPath = join(assetDir, "abadge-mcp");
      const archivePath = join(tempRoot, assetArchiveName);
      const installDir = join(tempRoot, "bin");

      mkdirSync(assetDir, { recursive: true });
      mkdirSync(installDir, { recursive: true });
      writeFileSync(binaryPath, "#!/usr/bin/env bash\necho abadge-mcp-test-build\n");
      chmodSync(binaryPath, 0o755);

      const tarProc = Bun.spawnSync(["tar", "-czf", archivePath, "-C", tempRoot, assetBaseName], {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
      });
      const decoder = new TextDecoder();
      expect(tarProc.exitCode).toBe(0);

      const checksum = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
      writeFileSync(join(tempRoot, "SHA256SUMS"), `${checksum}  ${assetArchiveName}\n`);

      const installProc = Bun.spawnSync(
        ["bash", "-lc", `cat "${join(repoRoot, "install.sh")}" | bash`],
        {
          cwd: repoRoot,
          env: mergedStringEnv({
            ABADGE_INSTALL_BASE_URL: `file://${tempRoot}`,
            ABADGE_INSTALL_DIR: installDir,
            ABADGE_INSTALL_PACKAGE: "mcp",
            ABADGE_MCP_VERSION: version,
            PATH: `${installDir}:${process.env.PATH ?? ""}`,
          }),
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      expect(installProc.exitCode).toBe(0);
      expect(decoder.decode(installProc.stderr)).toBe("");
      expect(readFileSync(join(installDir, "abadge-mcp"), "utf8")).toContain(
        "abadge-mcp-test-build",
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
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
    expect(releasePackages.map((pkg) => pkg.packageName)).not.toContain("@abadge/sdk");
  });

  test("release-surface matching includes shared release infrastructure", () => {
    const impactedPackages = getImpactedReleasePackages(["scripts/releases/publish.ts"]);
    expect(impactedPackages.map((pkg) => pkg.id)).toEqual(["cli"]);
  });

  test("sdk changes are treated as cli release-surface changes", () => {
    const impactedPackages = getImpactedReleasePackages(["packages/sdk/src/client.ts"]);
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

  test("default outdir is package-scoped", () => {
    expect(defaultOutDirForPackage(cliReleasePackage, "1.2.3")).toBe(
      join(repoRoot, "dist", "releases", "cli", "1.2.3"),
    );
  });
});

describe("installer helpers", () => {
  test("plain semver versions map to cli tags", () => {
    expect(runInstallerFunction('release_tag_for_version "1.2.3"')).toBe("cli-v1.2.3");
  });

  test("latest cli version prefers the newest stable cli tag from mixed releases", () => {
    const releasesJson = JSON.stringify([
      { tag_name: "sdk-v9.9.9" },
      { tag_name: "cli-v1.2.3" },
      { tag_name: "cli-v1.10.0" },
      { tag_name: "cli-v2.0.0-rc.1" },
      { tag_name: "mcp-v3.0.0" },
    ]);

    expect(
      runInstallerFunction('latest_cli_version_from_releases_json "$RELEASES_JSON"', {
        RELEASES_JSON: releasesJson,
      }),
    ).toBe("1.10.0");
  });

  test("asset naming uses the cli-specific asset prefix", () => {
    expect(
      runInstallerFunction('asset_archive_name_for_version_target "1.2.3" "linux-x64-baseline"'),
    ).toBe("abadge-cli-v1.2.3-linux-x64-baseline.tar.gz");
  });

  test("stdin execution installs the CLI without tripping over BASH_SOURCE", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "abadge-install-test-"));

    try {
      const version = "1.2.3";
      const assetTarget = runInstallerFunction("detect_asset_target");
      const assetBaseName = runInstallerFunction(
        `asset_base_name_for_version_target "${version}" "${assetTarget}"`,
      );
      const assetArchiveName = runInstallerFunction(
        `asset_archive_name_for_version_target "${version}" "${assetTarget}"`,
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
});

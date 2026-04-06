import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import process from "node:process";
import {
  isInitialCliPatchTrain,
  type ParsedChangeset,
  validateChangesetsTargetReleasePackages,
  validateCliChangesetsForInitialPatchTrain,
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

describe("changeset validation", () => {
  function changeset(path: string, releases: ParsedChangeset["releases"]): ParsedChangeset {
    return { path, releases };
  }

  test("rejects non-patch changesets while a release package is on 0.0.x", () => {
    expect(
      validateCliChangesetsForInitialPatchTrain(
        [changeset(".changeset/example.md", [{ name: "@abadge/cli", type: "minor" }])],
        "0.0.1",
      ),
    ).toEqual([
      ".changeset/example.md: @abadge/cli is currently 0.0.1, so it must use a patch changeset until we intentionally leave the 0.0.x train. Replace minor with patch.",
    ]);
  });

  test("allows patch changesets on 0.0.x and minor changesets after 0.0.x", () => {
    expect(
      validateCliChangesetsForInitialPatchTrain(
        [changeset(".changeset/patch.md", [{ name: "@abadge/cli", type: "patch" }])],
        "0.0.2",
      ),
    ).toEqual([]);
    expect(
      validateCliChangesetsForInitialPatchTrain(
        [changeset(".changeset/minor.md", [{ name: "@abadge/cli", type: "minor" }])],
        "0.1.0",
      ),
    ).toEqual([]);
  });

  test("patch-train validation ignores changesets that do not target the cli package", () => {
    expect(
      validateCliChangesetsForInitialPatchTrain(
        [changeset(".changeset/sdk.md", [{ name: "@abadge/sdk", type: "minor" }])],
        "0.0.1",
      ),
    ).toEqual([]);
  });

  test("detects the initial cli patch train from semver versions", () => {
    expect(isInitialCliPatchTrain("0.0.1")).toBe(true);
    expect(isInitialCliPatchTrain("0.0.2")).toBe(true);
    expect(isInitialCliPatchTrain("0.1.0")).toBe(false);
  });

  test("rejects changesets for packages outside the release registry", () => {
    expect(
      validateChangesetsTargetReleasePackages([
        changeset(".changeset/mcp.md", [{ name: "@abadge/mcp", type: "minor" }]),
      ]),
    ).toEqual([
      ".changeset/mcp.md: @abadge/mcp is not a release-managed package. Add it to scripts/releases/registry.ts before creating changesets for it.",
    ]);
  });

  test("allows changesets for packages that are in the release registry", () => {
    expect(
      validateChangesetsTargetReleasePackages([
        changeset(".changeset/cli.md", [{ name: "@abadge/cli", type: "patch" }]),
      ]),
    ).toEqual([]);
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
});

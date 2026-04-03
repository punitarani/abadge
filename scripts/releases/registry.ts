import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ReleasePlatform = {
  id: string;
  bunTarget: string;
};

export type GitHubBinaryTarget = {
  id: string;
  kind: "github-binary";
  tagPrefix: string;
  assetPrefix: string;
  releaseTitle: string;
  binaryName: string;
  entrypoint: string;
  buildCommand: readonly string[];
  prepareCommands?: readonly (readonly string[])[];
  platforms: readonly ReleasePlatform[];
};

export type ReleaseTarget = GitHubBinaryTarget;

export type ReleasePackage = {
  id: string;
  packageName: string;
  workspaceDir: string;
  versionSource: string;
  changePaths: readonly string[];
  targets: readonly ReleaseTarget[];
};

export const repoRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));

const cliPlatforms = [
  { id: "darwin-x64", bunTarget: "bun-darwin-x64" },
  { id: "darwin-arm64", bunTarget: "bun-darwin-arm64" },
  { id: "linux-x64-baseline", bunTarget: "bun-linux-x64-baseline" },
  { id: "linux-arm64-baseline", bunTarget: "bun-linux-arm64" },
  { id: "linux-x64-musl", bunTarget: "bun-linux-x64-musl" },
  { id: "linux-arm64-musl", bunTarget: "bun-linux-arm64-musl" },
] as const satisfies readonly ReleasePlatform[];

export const releasePackages = [
  {
    id: "cli",
    packageName: "@abadge/cli",
    workspaceDir: "packages/cli",
    versionSource: "packages/cli/package.json",
    changePaths: [
      "packages/cli/",
      "packages/daemon/",
      "packages/sdk/",
      "packages/core/",
      "packages/trpc/",
      "packages/crypto/",
      "install.sh",
      "scripts/release-cli.ts",
      "scripts/release-publish.ts",
      "scripts/releases/",
      ".github/workflows/release.yml",
      "README.md",
      "docs/CLI.md",
      "docs/DEVELOPMENT.md",
      "docs/ARCHITECTURE.md",
      "package.json",
    ],
    targets: [
      {
        id: "cli-binary",
        kind: "github-binary",
        tagPrefix: "cli-v",
        assetPrefix: "abadge-cli",
        releaseTitle: "abadge CLI",
        binaryName: "abadge",
        entrypoint: "packages/cli/bin/abadge.ts",
        buildCommand: ["bun", "build", "--compile"],
        prepareCommands: [["bun", "run", "--cwd", "packages/sdk", "build"]],
        platforms: cliPlatforms,
      },
    ],
  },
] as const satisfies readonly ReleasePackage[];

export function getReleasePackage(id: string): ReleasePackage {
  const releasePackage = releasePackages.find((candidate) => candidate.id === id);
  if (!releasePackage) {
    throw new Error(`Unknown release package: ${id}`);
  }
  return releasePackage;
}

function normalizeChangePath(changePath: string): string {
  return changePath.replace(/^\.\//, "");
}

export function matchesChangePath(changedFile: string, changePath: string): boolean {
  const normalizedFile = normalizeChangePath(changedFile);
  const normalizedPath = normalizeChangePath(changePath);
  return normalizedPath.endsWith("/")
    ? normalizedFile.startsWith(normalizedPath)
    : normalizedFile === normalizedPath;
}

export function getImpactedReleasePackages(changedFiles: readonly string[]): ReleasePackage[] {
  return releasePackages.filter((releasePackage) =>
    changedFiles.some((file) =>
      releasePackage.changePaths.some((changePath) => matchesChangePath(file, changePath)),
    ),
  );
}

export function validateReleaseRegistry(): string[] {
  const errors: string[] = [];
  const seenPackageIds = new Set<string>();
  const seenPackageNames = new Set<string>();

  for (const releasePackage of releasePackages) {
    if (seenPackageIds.has(releasePackage.id)) {
      errors.push(`Duplicate release package id: ${releasePackage.id}`);
    }
    seenPackageIds.add(releasePackage.id);

    if (seenPackageNames.has(releasePackage.packageName)) {
      errors.push(`Duplicate release package name: ${releasePackage.packageName}`);
    }
    seenPackageNames.add(releasePackage.packageName);

    const workspacePath = resolve(repoRoot, releasePackage.workspaceDir);
    if (!existsSync(workspacePath)) {
      errors.push(
        `Missing workspace directory for ${releasePackage.id}: ${releasePackage.workspaceDir}`,
      );
    }

    const versionSourcePath = resolve(repoRoot, releasePackage.versionSource);
    if (!existsSync(versionSourcePath)) {
      errors.push(
        `Missing version source for ${releasePackage.id}: ${releasePackage.versionSource}`,
      );
    }

    const seenTargetIds = new Set<string>();
    for (const target of releasePackage.targets) {
      if (seenTargetIds.has(target.id)) {
        errors.push(`Duplicate target id for ${releasePackage.id}: ${target.id}`);
      }
      seenTargetIds.add(target.id);
    }
  }

  return errors;
}

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { releasePackages, repoRoot } from "./registry";

export type ChangesetBumpType = "major" | "minor" | "patch";

export type ParsedChangesetRelease = {
  name: string;
  type: ChangesetBumpType;
};

export type ParsedChangeset = {
  path: string;
  releases: ParsedChangesetRelease[];
  summary: string;
};

const frontmatterEntryPattern = /^(?:"([^"]+)"|([^:\s]+)):\s*(major|minor|patch)$/;

export function isChangesetFile(file: string): boolean {
  return /^\.changeset\/(?!README\.md$)[^/]+\.md$/.test(file);
}

function displayPath(filePath: string): string {
  return filePath.startsWith(repoRoot) ? relative(repoRoot, filePath) : filePath;
}

export function parseChangesetDocument(contents: string, path: string): ParsedChangeset {
  const match = contents.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n([\s\S]*))?$/);
  if (!match) {
    throw new Error(`Invalid changeset frontmatter in ${displayPath(path)}`);
  }

  const [, rawFrontmatter, rawSummary = ""] = match;
  const releases = rawFrontmatter
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const entryMatch = line.match(frontmatterEntryPattern);
      if (!entryMatch) {
        throw new Error(`Unsupported changeset entry in ${displayPath(path)}: ${line}`);
      }

      const [, quotedName, bareName, type] = entryMatch;
      return {
        name: quotedName ?? bareName,
        type: type as ChangesetBumpType,
      };
    });

  return {
    path: displayPath(path),
    releases,
    summary: rawSummary.trim(),
  };
}

export async function readPendingChangesets(): Promise<ParsedChangeset[]> {
  const changesetDir = join(repoRoot, ".changeset");
  const entries = await readdir(changesetDir, { withFileTypes: true });
  const changesetFiles = entries
    .filter((entry) => entry.isFile() && isChangesetFile(`.changeset/${entry.name}`))
    .map((entry) => join(changesetDir, entry.name))
    .sort();

  return Promise.all(
    changesetFiles.map(async (filePath) =>
      parseChangesetDocument(await readFile(filePath, "utf8"), filePath),
    ),
  );
}

export async function getReleasePackageVersions(): Promise<Map<string, string>> {
  const versions = new Map<string, string>();

  for (const releasePackage of releasePackages) {
    const versionSourcePath = join(repoRoot, releasePackage.versionSource);
    const versionSource = JSON.parse(await readFile(versionSourcePath, "utf8")) as {
      version?: unknown;
    };

    if (typeof versionSource.version !== "string") {
      throw new Error(`Missing version in ${releasePackage.versionSource}`);
    }

    versions.set(releasePackage.packageName, versionSource.version);
  }

  return versions;
}

function isInitialPatchTrain(version: string): boolean {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) {
    throw new Error(`Invalid version string: ${version}`);
  }

  const [, major, minor] = match;
  return major === "0" && minor === "0";
}

export function validateInitialPatchTrainChangesets(
  changesets: readonly ParsedChangeset[],
  packageVersions: ReadonlyMap<string, string>,
): string[] {
  const errors: string[] = [];

  for (const changeset of changesets) {
    for (const release of changeset.releases) {
      const currentVersion = packageVersions.get(release.name);
      if (!currentVersion || !isInitialPatchTrain(currentVersion) || release.type === "patch") {
        continue;
      }

      errors.push(
        `${changeset.path}: ${release.name} is currently ${currentVersion}, so it must use a patch changeset until we intentionally leave the 0.0.x train. Replace ${release.type} with patch to avoid skipping straight to 0.1.0.`,
      );
    }
  }

  return errors;
}

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { getImpactedReleasePackages, repoRoot } from "./registry";

const CLI_PACKAGE_NAME = "@abadge/cli";
const CLI_PACKAGE_VERSION_SOURCE = join(repoRoot, "packages/cli/package.json");
const CHANGESET_DIR = join(repoRoot, ".changeset");
const CHANGESET_FILE_PATTERN = /^\.changeset\/(?!README\.md$)[^/]+\.md$/;
const CHANGESET_ENTRY_PATTERN = /^(?:"([^"]+)"|([^:\s]+)):\s*(major|minor|patch)$/;

export type ChangesetReleaseType = "major" | "minor" | "patch";

export type ParsedChangeset = {
  path: string;
  releases: readonly {
    name: string;
    type: ChangesetReleaseType;
  }[];
};

function getArgValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function isChangesetFile(file: string): boolean {
  return CHANGESET_FILE_PATTERN.test(file);
}

function parseChangeset(contents: string, path: string): ParsedChangeset {
  const match = contents.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n[\s\S]*)?$/);
  if (!match) {
    throw new Error(`Invalid changeset frontmatter in ${path}`);
  }

  const releases = match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const entryMatch = line.match(CHANGESET_ENTRY_PATTERN);
      if (!entryMatch) {
        throw new Error(`Unsupported changeset entry in ${path}: ${line}`);
      }

      const [, quotedName, bareName, type] = entryMatch;
      return {
        name: quotedName ?? bareName,
        type: type as ChangesetReleaseType,
      };
    });

  return { path, releases };
}

function readChangeset(path: string): ParsedChangeset {
  return parseChangeset(readFileSync(join(repoRoot, path), "utf8"), path);
}

function readPendingChangesets(): ParsedChangeset[] {
  return readdirSync(CHANGESET_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `.changeset/${entry.name}`)
    .filter((path) => isChangesetFile(path))
    .sort()
    .map((path) => readChangeset(path));
}

export function isInitialCliPatchTrain(version: string): boolean {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) {
    throw new Error(`Invalid version string: ${version}`);
  }

  const [, major, minor] = match;
  return major === "0" && minor === "0";
}

function readCliVersion(): string {
  const packageJson = JSON.parse(readFileSync(CLI_PACKAGE_VERSION_SOURCE, "utf8")) as {
    version?: unknown;
  };

  if (typeof packageJson.version !== "string") {
    throw new Error("Missing CLI version in packages/cli/package.json");
  }

  return packageJson.version;
}

export function validateCliChangesetsForInitialPatchTrain(
  changesets: readonly ParsedChangeset[],
  cliVersion: string,
): string[] {
  if (!isInitialCliPatchTrain(cliVersion)) {
    return [];
  }

  return changesets.flatMap((changeset) =>
    changeset.releases.flatMap((release) =>
      release.name === CLI_PACKAGE_NAME && release.type !== "patch"
        ? [
            `${changeset.path}: ${CLI_PACKAGE_NAME} is currently ${cliVersion}, so it must use a patch changeset until we intentionally leave the 0.0.x train. Replace ${release.type} with patch to avoid skipping straight to 0.1.0.`,
          ]
        : [],
    ),
  );
}

function runGit(command: readonly string[]): string {
  const proc = Bun.spawnSync(command, {
    stdout: "pipe",
    stderr: "pipe",
  });
  const decoder = new TextDecoder();

  if (proc.exitCode !== 0) {
    throw new Error(
      `Command failed (${proc.exitCode}): ${command.join(" ")}\n${decoder.decode(proc.stderr)}`,
    );
  }

  return decoder.decode(proc.stdout);
}

function ensureBaseRefHistory(baseRef: string): void {
  const isShallowRepository =
    runGit(["git", "rev-parse", "--is-shallow-repository"]).trim() === "true";

  runGit(
    isShallowRepository
      ? ["git", "fetch", "origin", baseRef, "--unshallow"]
      : ["git", "fetch", "origin", baseRef],
  );
}

function getChangedFiles(baseRef: string): string[] {
  ensureBaseRefHistory(baseRef);

  return runGit(["git", "diff", "--name-only", `origin/${baseRef}...HEAD`])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function getChangedChangesetFiles(changedFiles: readonly string[]): string[] {
  return changedFiles.filter((file) => isChangesetFile(file) && existsSync(join(repoRoot, file)));
}

function validateChangesets(changesets: readonly ParsedChangeset[]): void {
  const errors = validateCliChangesetsForInitialPatchTrain(changesets, readCliVersion());
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const baseRef = getArgValue(argv, "--base-ref");
  const validatePending = argv.includes("--validate-pending");

  if ((baseRef ? 1 : 0) + (validatePending ? 1 : 0) !== 1) {
    throw new Error("Use exactly one of --base-ref <branch> or --validate-pending");
  }

  if (validatePending) {
    validateChangesets(readPendingChangesets());
    return;
  }

  const changedFiles = getChangedFiles(baseRef);
  const impactedPackages = getImpactedReleasePackages(changedFiles);
  const changedChangesetFiles = getChangedChangesetFiles(changedFiles);

  if (changedChangesetFiles.length > 0) {
    validateChangesets(changedChangesetFiles.map((path) => readChangeset(path)));
  }

  if (impactedPackages.length === 0 || changedChangesetFiles.length > 0) {
    return;
  }

  throw new Error(
    `Release-surface changes for ${impactedPackages.map((pkg) => pkg.id).join(", ")} require a changeset in .changeset/*.md`,
  );
}

if (import.meta.main) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
